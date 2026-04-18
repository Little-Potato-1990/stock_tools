"use client";

import { useState, useEffect } from "react";
import { Newspaper, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { PageHeader } from "@/components/layout/PageHeader";

interface NewsItem {
  title: string;
  content: string;
  pub_time: string;
  related_concepts: string[];
}

export function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const openThemeDetail = useUIStore((s) => s.openThemeDetail);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await api.getNews(50);
      setNews(res as unknown as NewsItem[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  return (
    <div>
      <PageHeader
        title="财联社要闻"
        subtitle={news.length > 0 ? `${news.length} 条最新` : undefined}
        actions={
          <button
            onClick={fetchNews}
            disabled={loading}
            className="rounded transition-colors flex items-center gap-1"
            style={{
              padding: "4px 10px",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)",
              border: "1px solid var(--border-color)",
            }}
            title="刷新"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        }
      />

      <div className="px-3 py-2 space-y-1">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse"
              style={{ background: "var(--bg-card)" }}
            />
          ))
        ) : news.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <div
              className="w-14 h-14 rounded flex items-center justify-center"
              style={{ background: "var(--bg-tertiary)" }}
            >
              <Newspaper size={24} style={{ color: "var(--accent-blue)" }} />
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "var(--font-md)" }}>
              暂无新闻数据, 请稍后重试
            </div>
          </div>
        ) : (
          news.map((item, i) => (
            <div
              key={i}
              className="px-3 py-2"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-semibold leading-snug"
                    style={{ color: "var(--text-primary)", fontSize: "var(--font-md)" }}
                  >
                    {item.title}
                  </h3>
                  {item.content && (
                    <p
                      className="mt-1 leading-relaxed line-clamp-2"
                      style={{ color: "var(--text-muted)", fontSize: "var(--font-sm)" }}
                    >
                      {item.content}
                    </p>
                  )}
                  {item.related_concepts.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.related_concepts.map((concept) => (
                        <button
                          key={concept}
                          onClick={() => openThemeDetail(concept)}
                          className="rounded transition-colors"
                          style={{
                            padding: "1px 6px",
                            fontSize: 10,
                            background: "rgba(245,158,11,0.14)",
                            color: "var(--accent-orange)",
                            border: "1px solid rgba(245,158,11,0.3)",
                          }}
                        >
                          {concept}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {item.pub_time && (
                  <span
                    className="whitespace-nowrap flex-shrink-0 tabular-nums"
                    style={{ color: "var(--text-muted)", fontSize: 10 }}
                  >
                    {item.pub_time.slice(5, 16)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
