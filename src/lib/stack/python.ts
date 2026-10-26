/**
 * Turns a Python stack choice into a uv project: pyproject.toml lists every
 * chosen package (as `uv add` would write it, with test and lint tools in the
 * dev group), and the code uses each one — FastAPI or Flask routes, a Typer
 * command or a script, plus settings, a database, data, AI and output
 * libraries wired in where they belong. Pure; verify:stacks runs them.
 */

import { getLibrary, PY_FRAMEWORKS, type StackChoice } from './catalog.ts';

type Files = Record<string, string>;
const has = (c: StackChoice, id: string) => c.libraries.includes(id);

/** pyproject dependencies and the dev group, the way `uv add` / `uv add --dev` record them */
export function pythonDependencies(c: StackChoice): { dependencies: string[]; dev: string[] } {
  const deps: Record<string, string> = { ...PY_FRAMEWORKS.find((f) => f.id === c.pyFramework)!.deps };
  const dev: Record<string, string> = {};
  for (const id of c.libraries) {
    const lib = getLibrary(id)!;
    Object.assign(deps, lib.deps);
    Object.assign(dev, lib.dev);
  }
  // FastAPI's test client runs on HTTPX
  if (c.pyFramework === 'fastapi' && has(c, 'pytest') && !deps.httpx) dev.httpx = '>=0.28';
  const list = (o: Record<string, string>) =>
    Object.entries(o)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}${v}`);
  return { dependencies: list(deps), dev: list(dev) };
}

/** What you would type: `uv add fastapi uvicorn …` and `uv add --dev pytest ruff` */
export function uvCommands(c: StackChoice): string[] {
  const { dependencies, dev } = pythonDependencies(c);
  const names = (l: string[]) => l.map((d) => d.replace(/[<>=!~].*$/, '')).join(' ');
  return [...(dependencies.length ? [`uv add ${names(dependencies)}`] : []), ...(dev.length ? [`uv add --dev ${names(dev)}`] : [])];
}

const q = (s: string) => JSON.stringify(s);

function pyproject(c: StackChoice): string {
  const { dependencies, dev } = pythonDependencies(c);
  const arr = (l: string[]) => (l.length ? `[\n${l.map((d) => `    ${q(d)},`).join('\n')}\n]` : '[]');
  let out = `[project]
name = ${q(c.name)}
version = "0.1.0"
description = ${q(`${PY_FRAMEWORKS.find((f) => f.id === c.pyFramework)!.name} project`)}
readme = "README.md"
requires-python = ">=3.12"
dependencies = ${arr(dependencies)}
`;
  if (dev.length) out += `\n[dependency-groups]\ndev = ${arr(dev)}\n`;
  if (has(c, 'pytest')) out += `\n[tool.pytest.ini_options]\npythonpath = ["."]\ntestpaths = ["tests"]\n`;
  if (has(c, 'ruff')) out += `\n[tool.ruff]\nline-length = 100\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "UP", "B"]\n# Line length is left to ruff format\nignore = ["E501"]\n`;
  if (has(c, 'mypy')) out += `\n[tool.mypy]\nignore_missing_imports = true\n`;
  return out;
}

/** Imports go in ruff's isort order: standard library, then third party, then the project */
function imports(std: string[], third: string[], local: string[]): string {
  const sort = (l: string[]) =>
    [...new Set(l)].sort((a, b) => {
      const key = (s: string) => s.replace(/^(from|import) /, '').toLowerCase();
      // "import x" before "from x import" in the same section, as isort does with force-sort-within-sections off
      const ia = a.startsWith('import ') ? 0 : 1;
      const ib = b.startsWith('import ') ? 0 : 1;
      return ia - ib || key(a).localeCompare(key(b));
    });
  return [sort(std), sort(third), sort(local)]
    .filter((g) => g.length)
    .map((g) => g.join('\n'))
    .join('\n\n');
}

/** Small modules each library contributes, shared by every framework */
function modules(c: StackChoice): Files {
  const files: Files = {};
  if (has(c, 'pydantic-settings'))
    files['settings.py'] = `${imports([], ['from pydantic_settings import BaseSettings, SettingsConfigDict'], [])}


class Settings(BaseSettings):
    """Configuration from environment variables (or a .env file): APP_NAME=... overrides the default."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_")

    name: str = ${q(c.name)}
    debug: bool = False


settings = Settings()
`;
  if (has(c, 'sqlmodel'))
    files['db.py'] = `${imports(['from collections.abc import Iterator', 'from datetime import UTC, datetime'], ['from sqlmodel import Field, Session, SQLModel, create_engine, select'], [])}


class Note(SQLModel, table=True):
    """One table, typed: SQLModel models are also Pydantic models."""

    id: int | None = Field(default=None, primary_key=True)
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


engine = create_engine("sqlite:///data.db")
SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def recent_notes(session: Session, limit: int = 20) -> list[Note]:
    return list(session.exec(select(Note).order_by(Note.id.desc()).limit(limit)))  # type: ignore[union-attr]
`;
  const data = has(c, 'pandas') || has(c, 'polars') || has(c, 'numpy');
  if (data) {
    const third: string[] = [];
    let body = '';
    if (has(c, 'pandas')) {
      third.push('import pandas as pd');
      body = `    frame = pd.DataFrame(SALES)
    by_region = frame.groupby("region")["amount"].sum().sort_values(ascending=False)
    return {"total": float(frame["amount"].sum()), "by_region": {str(k): float(v) for k, v in by_region.items()}}`;
    } else if (has(c, 'polars')) {
      third.push('import polars as pl');
      body = `    frame = pl.DataFrame(SALES)
    by_region = frame.group_by("region").agg(pl.col("amount").sum()).sort("amount", descending=True)
    return {"total": float(frame["amount"].sum()), "by_region": dict(zip(by_region["region"], by_region["amount"], strict=True))}`;
    } else {
      body = `    amounts = np.array([row["amount"] for row in SALES], dtype=float)
    regions = sorted({row["region"] for row in SALES})
    totals = {r: float(sum(row["amount"] for row in SALES if row["region"] == r)) for r in regions}
    by_region = dict(sorted(totals.items(), key=lambda kv: -kv[1]))
    return {"total": float(amounts.sum()), "by_region": by_region}`;
    }
    if (has(c, 'numpy')) third.push('import numpy as np');
    const extra = has(c, 'numpy') && !body.includes('np.') ? `\n\n\ndef spread() -> float:\n    """Standard deviation of the sale amounts, with NumPy."""\n    return float(np.std([row["amount"] for row in SALES]))\n` : '';
    files['analysis.py'] = `${imports([], third, [])}

SALES = [
    {"region": "North", "amount": 120.0},
    {"region": "South", "amount": 80.0},
    {"region": "North", "amount": 45.5},
    {"region": "East", "amount": 99.9},
]


def summary() -> dict:
    """Total and per-region sales, largest first."""
${body}
${extra}`;
    if (has(c, 'matplotlib'))
      files['chart.py'] = `${imports([], ['import matplotlib', 'import matplotlib.pyplot as plt'], ['from analysis import summary'])}

matplotlib.use("Agg")


def save_chart(path: str = "sales.png") -> str:
    """A bar chart of sales per region, saved as an image."""
    by_region = summary()["by_region"]
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.bar(list(by_region), list(by_region.values()), color="#6366f1")
    ax.set_title("Sales by region")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


if __name__ == "__main__":
    print(f"Saved {save_chart()}")
`;
  } else if (has(c, 'matplotlib'))
    files['chart.py'] = `${imports([], ['import matplotlib', 'import matplotlib.pyplot as plt'], [])}

matplotlib.use("Agg")


def save_chart(path: str = "chart.png") -> str:
    """A small line chart, saved as an image."""
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.plot([1, 2, 3, 4], [3, 5, 4, 7], color="#6366f1")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


if __name__ == "__main__":
    print(f"Saved {save_chart()}")
`;
  if (has(c, 'anthropic') || has(c, 'openai')) {
    const anthropic = has(c, 'anthropic');
    files['ai.py'] = `${imports(['import os'], [], [])}


def ask(question: str) -> str:
    """Answer a question with ${anthropic ? 'Claude' : 'an OpenAI model'}. Needs ${anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in the environment."""
    if not os.environ.get(${q(anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')}):
        return "Set ${anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} to get a real answer."
${
  anthropic
    ? `    import anthropic

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-5-5",
        max_tokens=512,
        messages=[{"role": "user", "content": question}],
    )
    return "".join(block.text for block in message.content if block.type == "text")
`
    : `    from openai import OpenAI

    client = OpenAI()
    response = client.responses.create(model="gpt-5-mini", input=question)
    return response.output_text
`
}`;
  }
  return files;
}

function fastapiMain(c: StackChoice): string {
  const std: string[] = ['from datetime import UTC, datetime'];
  const third: string[] = ['from fastapi import FastAPI'];
  const local: string[] = [];
  if (has(c, 'pydantic') || has(c, 'sqlmodel') || has(c, 'anthropic') || has(c, 'openai')) third.push('from pydantic import BaseModel');
  if (has(c, 'jinja2')) third.push('from fastapi import Request', 'from fastapi.responses import HTMLResponse', 'from fastapi.templating import Jinja2Templates');
  else third.push('from fastapi.responses import HTMLResponse');
  if (has(c, 'sqlmodel')) {
    third.push('from fastapi import Depends, HTTPException', 'from sqlmodel import Session');
    std.push('from typing import Annotated');
    local.push('from db import Note, get_session, recent_notes');
  }
  if (has(c, 'dotenv')) third.push('from dotenv import load_dotenv');
  if (has(c, 'loguru')) third.push('from loguru import logger');
  if (has(c, 'pydantic-settings')) local.push('from settings import settings');
  if (modules(c)['analysis.py']) local.push('from analysis import summary');
  if (has(c, 'anthropic') || has(c, 'openai')) local.push('from ai import ask');
  // Merge "from fastapi import" lines into one
  const fastapiNames = third
    .filter((l) => l.startsWith('from fastapi import '))
    .flatMap((l) => l.replace('from fastapi import ', '').split(', '))
    .sort((a, b) => (a === a.toUpperCase() ? 0 : 1) - (b === b.toUpperCase() ? 0 : 1) || a.localeCompare(b));
  const thirdMerged = [...third.filter((l) => !l.startsWith('from fastapi import ')), `from fastapi import ${[...new Set(fastapiNames)].join(', ')}`];
  const title = has(c, 'pydantic-settings') ? 'settings.name' : q(c.name);
  let out = `${imports(std, thirdMerged, local)}

${has(c, 'dotenv') ? 'load_dotenv()\n' : ''}app = FastAPI(title=${title})
${has(c, 'jinja2') ? 'templates = Jinja2Templates(directory="templates")\n' : ''}${has(c, 'loguru') ? `logger.info("Starting {}", app.title)\n` : ''}
`;
  if (has(c, 'pydantic') || has(c, 'sqlmodel') || has(c, 'anthropic') || has(c, 'openai'))
    out += `
class Hello(BaseModel):
    message: str
    at: datetime
`;
  out += has(c, 'jinja2')
    ? `

@app.get("/", response_class=HTMLResponse)
def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {"title": app.title})
`
    : `

@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return PAGE
`;
  out += has(c, 'pydantic')
    ? `

@app.get("/api/hello")
def hello() -> Hello:
    return Hello(message="Hello from FastAPI", at=datetime.now(UTC))
`
    : `

@app.get("/api/hello")
def hello() -> dict:
    return {"message": "Hello from FastAPI", "at": datetime.now(UTC).isoformat()}
`;
  if (has(c, 'sqlmodel'))
    out += `

SessionDep = Annotated[Session, Depends(get_session)]


class NoteIn(BaseModel):
    text: str


@app.get("/api/notes")
def list_notes(session: SessionDep) -> list[Note]:
    return recent_notes(session)


@app.post("/api/notes", status_code=201)
def add_note(body: NoteIn, session: SessionDep) -> Note:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    note = Note(text=text)
    session.add(note)
    session.commit()
    session.refresh(note)
    return note
`;
  if (modules(c)['analysis.py'])
    out += `

@app.get("/api/sales")
def sales() -> dict:
    return summary()
`;
  if (has(c, 'anthropic') || has(c, 'openai'))
    out += `

class Question(BaseModel):
    question: str


@app.post("/api/ask")
def ask_model(body: Question) -> dict:
    return {"answer": ask(body.question)}
`;
  if (!has(c, 'jinja2')) out += `\n\n${pagePy(c)}`;
  return out;
}

/** The home page, as a Python string: it calls the API so you can see it working */
function pagePy(c: StackChoice): string {
  const extra = [modules(c)['analysis.py'] ? `fetch("/api/sales").then((r) => r.json()).then((s) => { document.querySelector("#sales").textContent = "Sales total: " + s.total; });` : '', has(c, 'sqlmodel') ? `fetch("/api/notes").then((r) => r.json()).then((n) => { document.querySelector("#notes").textContent = n.length + " note(s) in the database"; });` : ''].filter(Boolean);
  return `PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${c.name}</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e8eaf0; max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; }
      p { color: #9aa3b2; } a { color: #818cf8; }
    </style>
  </head>
  <body>
    <h1>${c.name}</h1>
    <p id="hello">Calling the API…</p>
    ${extra.length ? `<p id="sales"></p>\n    <p id="notes"></p>\n    ` : ''}<p>Interactive API docs: <a href="/docs">/docs</a></p>
    <script>
      fetch("/api/hello").then((r) => r.json()).then((h) => { document.querySelector("#hello").textContent = h.message; });
      ${extra.join('\n      ')}
    </script>
  </body>
</html>
"""
`;
}

function flaskMain(c: StackChoice): string {
  const third = [has(c, 'pydantic') ? 'from flask import Flask' : 'from flask import Flask, jsonify'];
  const local: string[] = [];
  if (has(c, 'dotenv')) third.push('from dotenv import load_dotenv');
  if (has(c, 'loguru')) third.push('from loguru import logger');
  if (has(c, 'pydantic')) third.push('from pydantic import BaseModel');
  if (has(c, 'pydantic-settings')) local.push('from settings import settings');
  if (modules(c)['analysis.py']) local.push('from analysis import summary');
  if (has(c, 'sqlmodel')) local.push('from db import Session, engine, recent_notes');
  let out = `${imports(['from datetime import UTC, datetime'], third, local)}

${has(c, 'dotenv') ? 'load_dotenv()\n' : ''}app = Flask(__name__)
${has(c, 'loguru') ? 'logger.info("Starting {}", app.name)\n' : ''}`;
  if (has(c, 'pydantic'))
    out += `

class Hello(BaseModel):
    message: str
    at: datetime
`;
  out += `

@app.get("/")
def home() -> str:
    return PAGE


@app.get("/api/hello")
def hello():
    ${has(c, 'pydantic') ? 'return Hello(message="Hello from Flask", at=datetime.now(UTC)).model_dump(mode="json")' : 'return jsonify(message="Hello from Flask", at=datetime.now(UTC).isoformat())'}
`;
  if (has(c, 'sqlmodel'))
    out += `

@app.get("/api/notes")
def notes():
    with Session(engine) as session:
        return [note.model_dump(mode="json") for note in recent_notes(session)]
`;
  if (modules(c)['analysis.py']) out += `\n\n@app.get("/api/sales")\ndef sales():\n    return summary()\n`;
  out += `\n\n${pagePy(c).replace('<p>Interactive API docs: <a href="/docs">/docs</a></p>\n    ', '')}`;
  return out;
}

function cliMain(c: StackChoice): string {
  const typer = c.pyFramework === 'typer';
  const rich = has(c, 'rich');
  const third: string[] = [];
  const local: string[] = [];
  if (typer) third.push('import typer');
  const table = rich && !!modules(c)['analysis.py'];
  if (rich) third.push('from rich.console import Console', ...(table ? ['from rich.table import Table'] : []));
  if (has(c, 'dotenv')) third.push('from dotenv import load_dotenv');
  if (has(c, 'loguru')) third.push('from loguru import logger');
  if (has(c, 'pydantic')) third.push('from pydantic import BaseModel');
  if (has(c, 'pydantic-settings')) local.push('from settings import settings');
  if (modules(c)['analysis.py']) local.push('from analysis import summary');
  if (has(c, 'anthropic') || has(c, 'openai')) local.push('from ai import ask');
  if (has(c, 'sqlmodel')) local.push('from db import Note, Session, engine, recent_notes');
  const say = rich ? 'console.print' : 'print';
  let out = `${imports([], third, local)}

${has(c, 'dotenv') ? 'load_dotenv()\n' : ''}${rich ? 'console = Console()\n' : ''}${typer ? 'app = typer.Typer(help=' + q(`${c.name}: a command-line tool.`) + ')\n' : ''}`;
  if (has(c, 'pydantic'))
    out += `

class Greeting(BaseModel):
    name: str
    excited: bool = False

    def text(self) -> str:
        return f"Hello, {self.name}{'!' if self.excited else '.'}"
`;
  const greet = has(c, 'pydantic') ? `Greeting(name=name, excited=excited).text()` : `f"Hello, {name}{'!' if excited else '.'}"`;
  const body: string[] = [`    ${say}(${greet})`];
  if (has(c, 'loguru')) body.unshift(`    logger.debug("greeting {}", name)`);
  if (modules(c)['analysis.py'])
    body.push(
      rich
        ? `    stats = summary()\n    table = Table("Region", "Sales")\n    for region, amount in stats["by_region"].items():\n        table.add_row(region, f"{amount:.2f}")\n    console.print(table)`
        : `    for region, amount in summary()["by_region"].items():\n        print(f"{region}: {amount:.2f}")`,
    );
  if (has(c, 'sqlmodel')) body.push(`    with Session(engine) as session:\n        session.add(Note(text=f"greeted {name}"))\n        session.commit()\n        ${say}(f"{len(recent_notes(session))} note(s) saved")`);
  if (typer) {
    out += `

@app.command()
def hello(name: str = "World", excited: bool = False) -> None:
    """Greet someone."""
${body.join('\n')}
`;
    if (has(c, 'anthropic') || has(c, 'openai')) out += `\n\n@app.command("ask")\ndef ask_command(question: str) -> None:\n    """Ask the model a question."""\n    ${say}(ask(question))\n`;
    else out += `\n\n@app.command()\ndef version() -> None:\n    """Show the version."""\n    ${say}("0.1.0")\n`;
    out += `\n\nif __name__ == "__main__":\n    app()\n`;
  } else {
    out += `

def main(name: str = "World", excited: bool = False) -> None:
${body.join('\n')}
${has(c, 'anthropic') || has(c, 'openai') ? `    ${say}(ask("Say hello in five words."))\n` : ''}

if __name__ == "__main__":
    main()
`;
  }
  return out;
}

function tests(c: StackChoice): Files {
  if (!has(c, 'pytest')) return {};
  const files: Files = { 'tests/__init__.py': '' };
  if (c.pyFramework === 'fastapi') {
    files['tests/test_app.py'] = `${imports([], ['from fastapi.testclient import TestClient'], ['from main import app'])}

client = TestClient(app)


def test_home_page() -> None:
    assert client.get("/").status_code == 200


def test_hello() -> None:
    body = client.get("/api/hello").json()
    assert body["message"] == "Hello from FastAPI"
${has(c, 'sqlmodel') ? `

def test_notes_round_trip() -> None:
    created = client.post("/api/notes", json={"text": "from a test"})
    assert created.status_code == 201
    assert any(n["text"] == "from a test" for n in client.get("/api/notes").json())
    assert client.post("/api/notes", json={"text": "  "}).status_code == 400
` : ''}`;
  } else if (c.pyFramework === 'flask') {
    files['tests/test_app.py'] = `${imports([], [], ['from app import app'])}


def test_hello() -> None:
    client = app.test_client()
    assert client.get("/").status_code == 200
    assert client.get("/api/hello").get_json()["message"] == "Hello from Flask"
`;
  } else if (c.pyFramework === 'typer') {
    files['tests/test_cli.py'] = `${imports([], ['from typer.testing import CliRunner'], ['from main import app'])}

runner = CliRunner()


def test_hello() -> None:
    result = runner.invoke(app, ["hello", "--name", "Ada", "--excited"])
    assert result.exit_code == 0
    assert "Hello, Ada!" in result.output
`;
  } else {
    files['tests/test_main.py'] = `${imports([], [], ['from main import main'])}


def test_main_greets(capsys) -> None:
    main("Ada", excited=True)
    assert "Hello, Ada!" in capsys.readouterr().out
`;
  }
  if (modules(c)['analysis.py'])
    files['tests/test_analysis.py'] = `${imports([], [], ['from analysis import summary'])}


def test_summary_totals_and_orders_regions() -> None:
    result = summary()
    assert round(result["total"], 1) == 345.4
    assert list(result["by_region"])[0] == "North"
`;
  return files;
}

function readme(c: StackChoice): string {
  const fw = PY_FRAMEWORKS.find((f) => f.id === c.pyFramework)!;
  const run = { fastapi: 'uv run uvicorn main:app --reload', flask: 'uv run flask --app app run --debug', typer: 'uv run main.py hello --name Ada', script: 'uv run main.py' }[c.pyFramework];
  return `# ${c.name}

${[fw.name, ...c.libraries.map((id) => getLibrary(id)!.name)].join(' · ')}

Press **Run** in the studio, or: \`${run}\`${has(c, 'pytest') ? `\n\nTests: \`uv run pytest\`` : ''}${has(c, 'ruff') ? ` · Lint: \`uv run ruff check .\` · Format: \`uv run ruff format .\`` : ''}

## The stack, and why

- **${fw.name}**: ${fw.blurb} ${fw.why}
${c.libraries.map((id) => getLibrary(id)!).map((l) => `- **${l.name}**: ${l.blurb} ${l.why}`).join('\n')}

## Adding packages

The packages are listed in pyproject.toml. These commands produce the same list:

${uvCommands(c)
  .map((cmd) => `    ${cmd}`)
  .join('\n')}
`;
}

/** The whole Python project for a (resolved) stack choice */
export function pythonProject(c: StackChoice): { files: Files; entry: string } {
  const files: Files = { 'pyproject.toml': pyproject(c), 'README.md': readme(c), '.gitignore': `.venv/\n__pycache__/\n.pytest_cache/\n.ruff_cache/\n.mypy_cache/\n${has(c, 'sqlmodel') ? 'data.db\n' : ''}${has(c, 'pydantic-settings') || has(c, 'dotenv') ? '.env\n' : ''}`, '.python-version': '3.12\n', ...modules(c), ...tests(c) };
  if (has(c, 'pydantic-settings') || has(c, 'dotenv') || has(c, 'anthropic') || has(c, 'openai'))
    files['.env.example'] = [has(c, 'pydantic-settings') ? `APP_NAME=${c.name}` : '', has(c, 'anthropic') ? 'ANTHROPIC_API_KEY=' : '', has(c, 'openai') ? 'OPENAI_API_KEY=' : ''].filter(Boolean).join('\n') + '\n';
  if (c.pyFramework === 'fastapi') {
    files['main.py'] = fastapiMain(c);
    if (has(c, 'jinja2'))
      files['templates/index.html'] = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{ title }}</title>
    <style>body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e8eaf0; max-width: 40rem; margin: 4rem auto; }</style>
  </head>
  <body>
    <h1>{{ title }}</h1>
    <p id="hello">Calling the API…</p>
    <p>Edit <code>templates/index.html</code>. API docs: <a href="/docs">/docs</a></p>
    <script>
      fetch("/api/hello").then((r) => r.json()).then((h) => { document.querySelector("#hello").textContent = h.message; });
    </script>
  </body>
</html>
`;
    return { files, entry: 'main.py' };
  }
  if (c.pyFramework === 'flask') {
    files['app.py'] = flaskMain(c);
    return { files, entry: 'app.py' };
  }
  files['main.py'] = cliMain(c);
  return { files, entry: 'main.py' };
}
