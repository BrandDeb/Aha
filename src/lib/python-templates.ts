/**
 * Python starter projects, managed with uv. Each is a complete project:
 * pyproject.toml plus code that runs as-is. The code is kept in String.raw so
 * Python's backslashes survive; none of it uses backticks or ${ }.
 */

import type { Template } from './templates.ts';

const pyproject = (name: string, description: string, dependencies: string[]) => String.raw`[project]
name = "${name}"
version = "0.1.0"
description = "${description}"
requires-python = ">=3.11"
dependencies = [
${dependencies.map((d) => `    "${d}",`).join('\n')}
]
`;

const LLM_AGENT = String.raw`"""A small LLM agent: chat with tools against any OpenAI-compatible endpoint.

Set these in the Python panel (or press "Use assistant provider" there):
  LLM_BASE_URL  https://api.groq.com/openai/v1   or  http://localhost:11434/v1  (Ollama)
  LLM_API_KEY   your key (Ollama needs none)
  LLM_MODEL     a model that supports tool calling

Run it:   run main.py "What is 17 * 23, and how many lines are in notes.txt?"
"""

import ast
import json
import operator
import os
import sys
from pathlib import Path

from openai import APIConnectionError, APIStatusError, OpenAI

MAX_STEPS = 6
DEFAULT_PROMPT = "What is (17 * 23) + 5? Then tell me how many lines notes.txt has."

# --- Tools the model may call -------------------------------------------------

_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def calculate(expression: str) -> str:
    """Evaluate arithmetic without eval(): numbers and + - * / ** % only."""

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPERATORS:
            return _OPERATORS[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPERATORS:
            return _OPERATORS[type(node.op)](walk(node.operand))
        raise ValueError("only numbers and + - * / ** % are allowed")

    return str(walk(ast.parse(expression, mode="eval")))


def read_file(path: str) -> str:
    """Read a text file from this project. Read-only, and it cannot leave the folder."""
    root = Path.cwd().resolve()
    target = (root / path).resolve()
    if root not in target.parents:
        return "error: path is outside the project"
    if not target.is_file():
        return f"error: {path} not found"
    return target.read_text(encoding="utf-8")[:4000]


FUNCTIONS = {"calculate": calculate, "read_file": read_file}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate an arithmetic expression such as (17 * 23) + 5.",
            "parameters": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the project by relative path.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]


def run_tool(name: str, arguments: str) -> str:
    try:
        return str(FUNCTIONS[name](**json.loads(arguments or "{}")))
    except Exception as error:  # tell the model what went wrong instead of crashing
        return f"error: {error}"


def main() -> int:
    base_url = os.environ.get("LLM_BASE_URL")
    model = os.environ.get("LLM_MODEL")
    if not base_url or not model:
        print("Set LLM_BASE_URL and LLM_MODEL (and LLM_API_KEY if the provider needs one).")
        print("In the Python panel, 'Use assistant provider' copies them from the Assistant.")
        return 2

    client = OpenAI(base_url=base_url, api_key=os.environ.get("LLM_API_KEY") or "not-needed")
    prompt = " ".join(sys.argv[1:]) or DEFAULT_PROMPT
    messages = [
        {"role": "system", "content": "You are a concise assistant. Use the tools when they help."},
        {"role": "user", "content": prompt},
    ]
    print(f"you: {prompt}\n")

    for _ in range(MAX_STEPS):
        try:
            reply = client.chat.completions.create(model=model, messages=messages, tools=TOOLS)
        except APIConnectionError:
            print(f"Could not reach {base_url}. Is the server running?")
            return 1
        except APIStatusError as error:
            print(f"The provider answered {error.status_code}: {error.message}")
            return 1

        message = reply.choices[0].message
        if not message.tool_calls:
            print(f"assistant: {message.content}")
            return 0

        messages.append(message.model_dump(exclude_none=True))
        for call in message.tool_calls:
            result = run_tool(call.function.name, call.function.arguments)
            print(f"  tool {call.function.name}({call.function.arguments}) -> {result}")
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})

    print("Stopped: the model kept calling tools.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;

const RAG = String.raw`"""Ask questions about the files in docs/ using embeddings (RAG).

Works with no setup: it ranks passages with a keyword score. Add embeddings for
meaning-based search, and an LLM for a written answer:

  EMBED_BASE_URL  http://localhost:11434/v1   (Ollama; run: ollama pull nomic-embed-text)
  EMBED_MODEL     nomic-embed-text            (hosted: text-embedding-3-small)
  EMBED_API_KEY   only for hosted providers
  LLM_BASE_URL / LLM_MODEL / LLM_API_KEY      to turn the best passages into an answer

Run it:   run main.py "How do I add a dependency?"
"""

import math
import os
import re
import sys
from collections import Counter
from pathlib import Path

import httpx
import numpy as np

DOCS = Path("docs")
DEFAULT_QUESTION = "How do I add a dependency?"
TOP_K = 3


def load_passages() -> list[tuple[str, str]]:
    """Every paragraph of every markdown file in docs/, with where it came from."""
    passages = []
    for file in sorted(DOCS.glob("*.md")):
        for block in re.split(r"\n\s*\n", file.read_text(encoding="utf-8")):
            block = block.strip()
            if len(block) >= 40 and not block.startswith("#"):
                passages.append((file.name, block))
    return passages


def embed(texts: list[str]) -> np.ndarray | None:
    """Vectors from an OpenAI-compatible /embeddings endpoint, or None if it isn't available."""
    base = os.environ.get("EMBED_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    model = os.environ.get("EMBED_MODEL", "nomic-embed-text")
    headers = {"Authorization": f"Bearer {os.environ['EMBED_API_KEY']}"} if os.environ.get("EMBED_API_KEY") else {}
    try:
        reply = httpx.post(f"{base}/embeddings", json={"model": model, "input": texts}, headers=headers, timeout=60)
        reply.raise_for_status()
        return np.array([item["embedding"] for item in reply.json()["data"]], dtype=float)
    except (httpx.HTTPError, KeyError, ValueError):
        return None


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def keyword_scores(question: str, passages: list[tuple[str, str]]) -> list[float]:
    """TF-IDF style scores: no model needed."""
    documents = [Counter(tokens(text)) for _, text in passages]
    n = len(documents)
    scores = []
    for doc in documents:
        total = sum(doc.values()) or 1
        score = 0.0
        for term in set(tokens(question)):
            containing = sum(1 for d in documents if term in d)
            if containing:
                score += (doc[term] / total) * math.log(1 + n / containing)
        scores.append(score)
    return scores


def answer(question: str, context: list[str]) -> str | None:
    base, model = os.environ.get("LLM_BASE_URL"), os.environ.get("LLM_MODEL")
    if not base or not model:
        return None
    headers = {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"} if os.environ.get("LLM_API_KEY") else {}
    prompt = "Answer using only this context.\n\n" + "\n---\n".join(context) + f"\n\nQuestion: {question}"
    try:
        reply = httpx.post(
            f"{base.rstrip('/')}/chat/completions",
            json={"model": model, "messages": [{"role": "user", "content": prompt}]},
            headers=headers,
            timeout=120,
        )
        reply.raise_for_status()
        return reply.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, ValueError) as error:
        return f"(could not get an answer from the LLM: {error})"


def main() -> int:
    question = " ".join(sys.argv[1:]) or DEFAULT_QUESTION
    passages = load_passages()
    if not passages:
        print("No passages found: add markdown files to docs/.")
        return 1

    vectors = embed([text for _, text in passages] + [question])
    if vectors is not None:
        *rows, query = vectors
        matrix = np.array(rows)
        scores = (matrix @ query) / (np.linalg.norm(matrix, axis=1) * np.linalg.norm(query) + 1e-9)
        method = "embeddings"
    else:
        scores = np.array(keyword_scores(question, passages))
        method = "keyword score (set EMBED_BASE_URL for meaning-based search)"

    print(f"question: {question}\nsearch:   {method}\n")
    best = np.argsort(scores)[::-1][:TOP_K]
    for rank, index in enumerate(best, start=1):
        source, text = passages[index]
        print(f"{rank}. [{scores[index]:.3f}] {source}\n   {text}\n")

    written = answer(question, [passages[i][1] for i in best])
    print(f"answer: {written}" if written else "Set LLM_BASE_URL and LLM_MODEL to get a written answer from these passages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

const RAG_DOCS: Record<string, string> = {
  'docs/uv.md': String.raw`# uv

uv is a fast Python package and project manager. It keeps a project's dependencies in pyproject.toml and records exact versions in uv.lock.

To add a dependency, run uv add followed by the package name, for example uv add httpx. uv resolves versions, updates pyproject.toml and installs the package into the project's virtual environment.

To remove a dependency use uv remove. To install everything the project declares, run uv sync. uv lock re-resolves versions without installing anything.

A single script can declare its own dependencies in a comment block at the top, so it runs with uv run script.py and needs no project at all.
`,
  'docs/scriptc.md': String.raw`# scriptc

scriptc compiles TypeScript to a native executable or a WebAssembly module through LLVM. There is no JavaScript engine in the output, so a hello world is a few dozen kilobytes and starts in about a millisecond.

A program is built from an entry file, and relative imports between files work. Code that cannot compile statically is reported with an error code and a hint on how to rewrite it.

The wasm32-wasi target produces a portable module, but WebAssembly in the browser has no network sockets, so programs using http or fetch need the native target.
`,
  'docs/studio.md': String.raw`# NanoCLI Studio

NanoCLI Studio is a browser workspace for building command-line tools. It has a file explorer, a Monaco editor, a terminal and an assistant that can use free models or your own key.

The terminal can run TypeScript as WebAssembly in the tab and Python through uv on the machine running the studio. Output menus let you inspect LLVM IR, assembly and WebAssembly text.

Environment variables for Python programs, such as API keys, are set in the Python panel and stay in the browser.
`,
};

const OLLAMA = String.raw`"""Chat with a local model through Ollama: free, private, no API key.

Setup (once):  install Ollama from https://ollama.com, then in a terminal
               ollama pull qwen2.5-coder:7b

Run it:   run main.py "Explain what a closure is in two sentences"
Pick a model with OLLAMA_MODEL; otherwise the first installed one is used.
"""

import json
import os
import sys

import httpx

HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
DEFAULT_PROMPT = "Write a haiku about compilers."


def installed_models() -> list[str]:
    reply = httpx.get(f"{HOST}/api/tags", timeout=10)
    reply.raise_for_status()
    return [model["name"] for model in reply.json().get("models", [])]


def main() -> int:
    prompt = " ".join(sys.argv[1:]) or DEFAULT_PROMPT
    try:
        models = installed_models()
    except httpx.HTTPError:
        print(f"Could not reach Ollama at {HOST}.")
        print("Start it (ollama serve) or install it from https://ollama.com, then run this again.")
        return 1

    model = os.environ.get("OLLAMA_MODEL") or (models[0] if models else None)
    if not model:
        print("Ollama has no models yet. Try:  ollama pull qwen2.5-coder:7b")
        return 1

    print(f"model: {model}\nyou:   {prompt}\n")
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True}
    with httpx.stream("POST", f"{HOST}/api/chat", json=body, timeout=None) as reply:
        if reply.status_code != 200:
            reply.read()
            print(f"Ollama answered {reply.status_code}: {reply.text}")
            return 1
        for line in reply.iter_lines():
            if not line:
                continue
            chunk = json.loads(line)
            print(chunk.get("message", {}).get("content", ""), end="", flush=True)
            if chunk.get("done"):
                break
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

const DATA = String.raw`"""Summarise a CSV with pandas and write a report.

Run it:   run main.py            (top 3 products)
          run main.py --top 5

Writes summary.csv and report.md next to this file; they appear in the explorer.
"""

import argparse

import pandas as pd


def main() -> int:
    parser = argparse.ArgumentParser(description="Sales summary")
    parser.add_argument("--top", type=int, default=3, help="how many products to list")
    args = parser.parse_args()

    sales = pd.read_csv("data/sales.csv", parse_dates=["date"])
    sales["revenue"] = sales["units"] * sales["price"]

    by_region = sales.groupby("region")["revenue"].sum().sort_values(ascending=False)
    by_product = sales.groupby("product").agg(units=("units", "sum"), revenue=("revenue", "sum")).sort_values("revenue", ascending=False)
    by_month = sales.groupby(sales["date"].dt.strftime("%Y-%m"))["revenue"].sum()

    print(f"{len(sales)} orders, {sales['revenue'].sum():,.2f} total revenue\n")
    print("Revenue by region")
    print(by_region.round(2).to_string(), "\n")
    print(f"Top {args.top} products")
    print(by_product.head(args.top).round(2).to_string(), "\n")
    print("Revenue by month")
    print(by_month.round(2).to_string())

    by_product.round(2).to_csv("summary.csv")
    best = by_product.index[0]
    report = [
        "# Sales report",
        "",
        f"- Orders: {len(sales)}",
        f"- Total revenue: {sales['revenue'].sum():,.2f}",
        f"- Best product: {best} ({by_product.loc[best, 'revenue']:,.2f})",
        f"- Best region: {by_region.index[0]} ({by_region.iloc[0]:,.2f})",
        "",
        "## Revenue by month",
        "",
        *[f"- {month}: {value:,.2f}" for month, value in by_month.round(2).items()],
        "",
    ]
    with open("report.md", "w", encoding="utf-8") as handle:
        handle.write("\n".join(report))
    print("\nWrote summary.csv and report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

const SALES_CSV = `date,region,product,units,price
2026-01-04,north,widget,12,9.99
2026-01-09,south,gadget,5,24.5
2026-01-15,east,widget,7,9.99
2026-01-21,west,doohickey,3,59.0
2026-01-28,north,gadget,9,24.5
2026-02-02,south,widget,20,9.99
2026-02-07,east,doohickey,2,59.0
2026-02-13,west,gadget,6,24.5
2026-02-19,north,widget,15,9.99
2026-02-25,south,doohickey,4,59.0
2026-03-03,east,gadget,11,24.5
2026-03-08,west,widget,18,9.99
2026-03-14,north,doohickey,5,59.0
2026-03-20,south,gadget,8,24.5
2026-03-27,east,widget,10,9.99
2026-04-02,west,doohickey,6,59.0
2026-04-09,north,gadget,14,24.5
2026-04-16,south,widget,22,9.99
2026-04-23,east,doohickey,3,59.0
2026-04-30,west,gadget,7,24.5
`;

const MCP = String.raw`"""A Model Context Protocol (MCP) server in a few lines, with FastMCP.

MCP lets AI apps (Claude Desktop, IDE assistants, agents) call your code as tools.
Here the server exposes two tools and a resource. The SDK is pinned below 2.0, where FastMCP
was renamed; update the import and the pin together when you move to 2.x.

Run it here:   run main.py            lists the tools and calls each one locally
Serve it:      uv run main.py --serve   speaks MCP over stdio for a client to launch
"""

import asyncio
import sys

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("nanocli-demo")


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


@mcp.tool()
def word_count(text: str) -> dict:
    """Count the words and characters in some text."""
    return {"words": len(text.split()), "characters": len(text)}


@mcp.resource("greeting://{name}")
def greeting(name: str) -> str:
    """A personalised greeting."""
    return f"Hello, {name}!"


async def demo() -> None:
    print("Tools this server exposes:")
    for tool in await mcp.list_tools():
        print(f"  {tool.name}: {tool.description}")
    print()
    print("add(2, 3)           =", add(2, 3))
    print("word_count('a b c')  =", word_count("a b c"))
    print("greeting('Ada')      =", greeting("Ada"))


if __name__ == "__main__":
    if "--serve" in sys.argv:
        mcp.run()  # stdio transport: a client launches this process and talks to it
    else:
        asyncio.run(demo())
`;

const SCRIPT = String.raw`# /// script
# requires-python = ">=3.11"
# dependencies = ["rich"]
# ///
"""A single-file script with its own dependencies (PEP 723).

The comment block above is all uv needs: no pyproject.toml, no virtual
environment to manage. uv creates a cached environment the first time.

Run it:   run main.py
"""

from rich.console import Console
from rich.table import Table

console = Console()
table = Table(title="uv in one file")
table.add_column("Step")
table.add_column("What happens")
table.add_row("1", "uv reads the # /// script block")
table.add_row("2", "installs rich into a cached environment")
table.add_row("3", "runs this file")
console.print(table)
console.print("[bold green]Done.[/] Add more packages to the block, or use uv add --script main.py <package>.")
`;

export const PYTHON_TEMPLATES: Template[] = [
  {
    id: 'py-llm-agent',
    name: 'LLM agent with tools',
    description: 'Chat with any OpenAI-compatible model; it can call a calculator and read files',
    filename: 'main.py',
    language: 'python',
    code: LLM_AGENT,
    files: {
      'pyproject.toml': pyproject('llm-agent', 'A tool-calling LLM agent', ['openai>=1.50']),
      'notes.txt': 'First line of the notes.\nSecond line.\nThird line.\n',
    },
  },
  {
    id: 'py-rag',
    name: 'Embeddings + search (RAG)',
    description: 'Search your own documents by meaning, then answer from the best passages',
    filename: 'main.py',
    language: 'python',
    code: RAG,
    files: { 'pyproject.toml': pyproject('rag-search', 'Question answering over local documents', ['httpx>=0.27', 'numpy>=1.26']), ...RAG_DOCS },
  },
  {
    id: 'py-ollama',
    name: 'Local model (Ollama)',
    description: 'Stream answers from a model running on your own machine; no key, nothing leaves it',
    filename: 'main.py',
    language: 'python',
    code: OLLAMA,
    files: { 'pyproject.toml': pyproject('ollama-chat', 'Chat with a local Ollama model', ['httpx>=0.27']) },
  },
  {
    id: 'py-data',
    name: 'Data analysis (pandas)',
    description: 'Summarise a CSV and write a report and a summary table into the project',
    filename: 'main.py',
    language: 'python',
    code: DATA,
    files: { 'pyproject.toml': pyproject('sales-report', 'Sales summary with pandas', ['pandas>=2.2']), 'data/sales.csv': SALES_CSV },
  },
  {
    id: 'py-mcp',
    name: 'MCP server',
    description: 'Expose Python functions as tools that AI apps and agents can call',
    filename: 'main.py',
    language: 'python',
    code: MCP,
    files: { 'pyproject.toml': pyproject('mcp-demo', 'A Model Context Protocol server', ['mcp>=1.2,<2']) },
  },
  {
    id: 'py-script',
    name: 'Single-file script (uv)',
    description: 'Dependencies declared inside the file itself: no project, no environment to manage',
    filename: 'main.py',
    language: 'python',
    code: SCRIPT,
  },
];
