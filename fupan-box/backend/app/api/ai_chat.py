from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import date, datetime

from app.database import get_db
from app.api.auth import get_current_user
from app.api.quota import check_and_log_quota
from app.models.user import User
from app.models.ai import AIConversation, AIMessage
from app.ai.models import get_models_dict, DEFAULT_MODEL, AVAILABLE_MODELS
from app.ai.llm_service import stream_chat

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    model_id: str = DEFAULT_MODEL
    conversation_id: int | None = None
    trade_date: str | None = None
    context: dict | None = None


@router.get("/models")
async def list_models():
    return get_models_dict()


@router.post("/chat")
async def chat(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    valid_ids = {m.id for m in AVAILABLE_MODELS}
    if req.model_id not in valid_ids:
        raise HTTPException(400, f"Invalid model: {req.model_id}")

    await check_and_log_quota(db, user, action="chat", model=req.model_id)

    # Get or create conversation
    conversation_id = req.conversation_id
    if conversation_id:
        conv_result = await db.execute(
            select(AIConversation).where(
                AIConversation.id == conversation_id,
                AIConversation.user_id == user.id,
            )
        )
        conv = conv_result.scalar_one_or_none()
        if not conv:
            raise HTTPException(404, "Conversation not found")
    else:
        title = req.message[:50] + ("..." if len(req.message) > 50 else "")
        conv = AIConversation(
            user_id=user.id,
            trade_date=date.fromisoformat(req.trade_date) if req.trade_date else date.today(),
            title=title,
        )
        db.add(conv)
        await db.flush()
        conversation_id = conv.id

    # Save user message
    user_msg = AIMessage(
        conversation_id=conversation_id,
        role="user",
        content=req.message,
    )
    db.add(user_msg)
    await db.commit()

    # Build message history for LLM
    history_result = await db.execute(
        select(AIMessage)
        .where(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at.asc())
    )
    history = history_result.scalars().all()
    messages = [{"role": m.role, "content": m.content} for m in history if m.role in ("user", "assistant")]

    async def event_stream():
        full_content = ""
        async for sse_line in stream_chat(
            req.model_id, messages, req.trade_date, user_context=req.context
        ):
            if '"done": true' in sse_line or '"done":true' in sse_line:
                import json
                try:
                    data_str = sse_line.replace("data: ", "").strip()
                    data = json.loads(data_str)
                    full_content = data.get("full_content", full_content)
                except Exception:
                    pass

                # Save assistant message
                assistant_msg = AIMessage(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=full_content,
                )
                db.add(assistant_msg)
                conv.updated_at = datetime.now()
                await db.commit()

                yield f"data: {json.dumps({'done': True, 'conversation_id': conversation_id}, ensure_ascii=False)}\n\n"
            else:
                yield sse_line

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/conversations")
async def list_conversations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.user_id == user.id)
        .order_by(AIConversation.updated_at.desc())
        .limit(30)
    )
    convs = result.scalars().all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "trade_date": c.trade_date.isoformat() if c.trade_date else None,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in convs
    ]


@router.get("/conversations/{conv_id}/messages")
async def get_conversation_messages(
    conv_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await db.execute(
        select(AIConversation).where(
            AIConversation.id == conv_id,
            AIConversation.user_id == user.id,
        )
    )
    if not conv.scalar_one_or_none():
        raise HTTPException(404, "Conversation not found")

    result = await db.execute(
        select(AIMessage)
        .where(AIMessage.conversation_id == conv_id)
        .order_by(AIMessage.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]
