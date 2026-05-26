from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile
import re


WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


@dataclass(frozen=True, slots=True)
class KnowledgeChunk:
    source: str
    text: str


def extract_docx_paragraphs(path: Path) -> list[str]:
    with ZipFile(path) as package:
        xml = package.read("word/document.xml")
    root = ET.fromstring(xml)
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", WORD_NS):
        pieces = [node.text or "" for node in paragraph.findall(".//w:t", WORD_NS)]
        text = "".join(pieces).strip()
        if text:
            paragraphs.append(re.sub(r"\s+", " ", text))
    return paragraphs


def load_knowledge(files: tuple[Path, ...]) -> tuple[list[KnowledgeChunk], list[dict[str, str | int | bool]]]:
    chunks: list[KnowledgeChunk] = []
    files_info: list[dict[str, str | int | bool]] = []
    for path in files:
        info: dict[str, str | int | bool] = {"name": path.name, "path": str(path), "exists": path.exists(), "paragraphs": 0}
        if not path.exists():
            files_info.append(info)
            continue
        paragraphs = extract_docx_paragraphs(path)
        info["paragraphs"] = len(paragraphs)
        files_info.append(info)
        buffer: list[str] = []
        size = 0
        for paragraph in paragraphs:
            if size + len(paragraph) > 900 and buffer:
                chunks.append(KnowledgeChunk(path.name, "\n".join(buffer)))
                buffer = []
                size = 0
            buffer.append(paragraph)
            size += len(paragraph)
        if buffer:
            chunks.append(KnowledgeChunk(path.name, "\n".join(buffer)))
    return chunks, files_info


def tokenize_query(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z_][A-Za-z0-9_]*|[\u4e00-\u9fff]{2,}", text or "")
    tokens: list[str] = []
    for item in raw:
        if len(item) > 8 and re.fullmatch(r"[\u4e00-\u9fff]+", item):
            tokens.extend(item[i : i + 2] for i in range(0, len(item) - 1, 2))
        else:
            tokens.append(item.lower())
    return tokens


def search_knowledge(chunks: list[KnowledgeChunk], query: str, limit: int = 8) -> list[KnowledgeChunk]:
    if not chunks:
        return []
    tokens = tokenize_query(query)
    if not tokens:
        return chunks[:limit]

    scored: list[tuple[int, int, KnowledgeChunk]] = []
    for index, chunk in enumerate(chunks):
        haystack = chunk.text.lower()
        score = sum(haystack.count(token) for token in tokens)
        if score:
            scored.append((score, -index, chunk))
    scored.sort(reverse=True)
    if not scored:
        return chunks[:limit]
    return [item[2] for item in scored[:limit]]


def knowledge_context(chunks: list[KnowledgeChunk], query: str, limit: int = 8, max_chars: int = 5200) -> str:
    selected = search_knowledge(chunks, query, limit)
    parts: list[str] = []
    total = 0
    for chunk in selected:
        item = f"【{chunk.source}】\n{chunk.text}"
        if total + len(item) > max_chars:
            if not parts:
                parts.append(item[:max_chars].rstrip())
            break
        parts.append(item)
        total += len(item)
    return "\n\n".join(parts)
