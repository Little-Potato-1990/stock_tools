"""news ingest + AI brief module.

子模块:
- sources/   多渠道采集 (akshare / tushare / RSS)
- ingest.py  归一化 + SimHash 去重 + 写库
- ranker.py  关联热度排序 (Phase 3)
"""
