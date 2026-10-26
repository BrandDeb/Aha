/**
 * Full apps in every language: the same small Todo app (a page, and a JSON
 * API it talks to) served by each language's usual web stack, so the live
 * preview shows a working app from the first second and you change it from
 * there, by hand or by asking the agent. Each serves index.html at / and
 * GET/POST /api/todos, listens on 127.0.0.1:$PORT, and runs with the
 * dev-server host (lib/app-servers.ts).
 */

export interface AppStarter {
  id: string;
  name: string;
  description: string;
  language: string;
  /** The file to open first */
  filename: string;
  code: string;
  files: Record<string, string>;
}

/** What the page shows, so tests can check it rendered */
export const APP_PAGE_TITLE = 'Todos';

/** The page every server sends: plain HTML, CSS and a little JavaScript that calls the API */
export const APP_PAGE = (stack: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_PAGE_TITLE} · ${stack}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e8eaf0; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: start center; padding: 4rem 1rem; }
    main { width: 100%; max-width: 28rem; }
    h1 { margin: 0; font-size: 2rem; letter-spacing: -0.02em; }
    .stack { color: #8b93a7; font-size: 0.85rem; margin: 0.25rem 0 1.5rem; }
    form { display: flex; gap: 0.5rem; }
    input { flex: 1; padding: 0.65rem 0.8rem; border-radius: 0.6rem; border: 1px solid #2a3140; background: #121620; color: inherit; font: inherit; }
    button { padding: 0.65rem 1rem; border-radius: 0.6rem; border: 0; background: #7c9cff; color: #0b0d12; font: inherit; font-weight: 600; cursor: pointer; }
    ul { list-style: none; padding: 0; margin: 1.25rem 0 0; }
    li { padding: 0.7rem 0.8rem; border: 1px solid #1f2532; border-radius: 0.6rem; margin-bottom: 0.5rem; background: #10141c; }
    .empty { color: #8b93a7; }
  </style>
</head>
<body>
  <main>
    <h1>${APP_PAGE_TITLE}</h1>
    <p class="stack">Served by ${stack} · the list lives in the server's memory</p>
    <form id="add">
      <input name="title" placeholder="What needs doing?" autocomplete="off" required />
      <button>Add</button>
    </form>
    <ul id="list"></ul>
  </main>
  <script>
    const list = document.getElementById('list');
    async function load() {
      const todos = await (await fetch('/api/todos')).json();
      list.innerHTML = todos.length ? '' : '<li class="empty">Nothing yet: add the first one.</li>';
      for (const t of todos) {
        const li = document.createElement('li');
        li.textContent = t.title;
        list.appendChild(li);
      }
    }
    document.getElementById('add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.elements.title;
      await fetch('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: input.value }) });
      input.value = '';
      load();
    });
    load();
  </script>
</body>
</html>
`;

const readme = (name: string, run: string, edit: string) => `# ${name}

A small full app: a page at \`/\` and a JSON API at \`/api/todos\` (\`GET\` lists, \`POST {"title": "…"}\` adds).

- **Run**: press Run in Aha!; the preview opens with the app. Or: \`${run}\`
- **Change it**: edit \`${edit}\` (the server) or \`index.html\` (the page), or ask the agent ("store todos in SQLite", "add a done checkbox").
`;

export const APP_STARTERS: AppStarter[] = [
  {
    id: 'app-fastapi',
    name: 'Python · FastAPI app',
    description: 'A full app on FastAPI: a page and a JSON API, auto-reloading with uvicorn, managed by uv',
    language: 'python',
    filename: 'main.py',
    code: `from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

app = FastAPI()
todos: list[dict] = [{"id": 1, "title": "Try the live preview"}]


class NewTodo(BaseModel):
    title: str


@app.get("/", response_class=HTMLResponse)
def page() -> str:
    return Path(__file__).with_name("index.html").read_text()


@app.get("/api/todos")
def list_todos() -> list[dict]:
    return todos


@app.post("/api/todos", status_code=201)
def add_todo(todo: NewTodo) -> dict:
    item = {"id": len(todos) + 1, "title": todo.title.strip()}
    todos.append(item)
    return item
`,
    files: {
      'index.html': APP_PAGE('Python · FastAPI'),
      'pyproject.toml': `[project]
name = "todo-fastapi"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.115", "uvicorn>=0.32"]
`,
      'README.md': readme('Todo app · FastAPI', 'uv run uvicorn main:app --reload', 'main.py'),
    },
  },
  {
    id: 'app-flask',
    name: 'Python · Flask app',
    description: 'A full app on Flask: a page and a JSON API, reloading in debug mode, managed by uv',
    language: 'python',
    filename: 'app.py',
    code: `from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)
todos = [{"id": 1, "title": "Try the live preview"}]


@app.get("/")
def page():
    return Path(__file__).with_name("index.html").read_text()


@app.get("/api/todos")
def list_todos():
    return jsonify(todos)


@app.post("/api/todos")
def add_todo():
    title = (request.get_json(silent=True) or {}).get("title", "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    item = {"id": len(todos) + 1, "title": title}
    todos.append(item)
    return jsonify(item), 201
`,
    files: {
      'index.html': APP_PAGE('Python · Flask'),
      'pyproject.toml': `[project]
name = "todo-flask"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["flask>=3.0"]
`,
      'README.md': readme('Todo app · Flask', 'uv run flask --app app run --debug', 'app.py'),
    },
  },
  {
    id: 'app-go',
    name: 'Go app',
    description: 'A full app in Go with only the standard library: net/http routing, JSON and an embedded page',
    language: 'go',
    filename: 'main.go',
    code: `package main

import (
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
)

//go:embed index.html
var page []byte

type Todo struct {
	ID    int    \`json:"id"\`
	Title string \`json:"title"\`
}

var (
	mu    sync.Mutex
	todos = []Todo{{ID: 1, Title: "Try the live preview"}}
)

func main() {
	http.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	http.HandleFunc("GET /api/todos", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		writeJSON(w, http.StatusOK, todos)
	})
	http.HandleFunc("POST /api/todos", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Title string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || strings.TrimSpace(in.Title) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
			return
		}
		mu.Lock()
		todo := Todo{ID: len(todos) + 1, Title: strings.TrimSpace(in.Title)}
		todos = append(todos, todo)
		mu.Unlock()
		writeJSON(w, http.StatusCreated, todo)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Listening on http://127.0.0.1:%s/", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, nil))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
`,
    files: {
      'index.html': APP_PAGE('Go · net/http'),
      'go.mod': 'module todo\n\ngo 1.22\n',
      'README.md': readme('Todo app · Go', 'go run .', 'main.go'),
    },
  },
  {
    id: 'app-rust',
    name: 'Rust · axum app',
    description: 'A full app on axum and tokio: typed JSON routes and a page, rebuilt on every change',
    language: 'rust',
    filename: 'src/main.rs',
    code: `use axum::{extract::State, http::StatusCode, response::Html, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize)]
struct Todo {
    id: usize,
    title: String,
}

#[derive(Deserialize)]
struct NewTodo {
    title: String,
}

type Todos = Arc<Mutex<Vec<Todo>>>;

#[tokio::main]
async fn main() {
    let todos: Todos = Arc::new(Mutex::new(vec![Todo { id: 1, title: "Try the live preview".into() }]));
    let app = Router::new()
        .route("/", get(|| async { Html(include_str!("../index.html")) }))
        .route("/api/todos", get(list).post(add))
        .with_state(todos);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    println!("Listening on http://127.0.0.1:{port}/");
    axum::serve(listener, app).await.unwrap();
}

async fn list(State(todos): State<Todos>) -> Json<Vec<Todo>> {
    Json(todos.lock().unwrap().clone())
}

async fn add(State(todos): State<Todos>, Json(input): Json<NewTodo>) -> Result<(StatusCode, Json<Todo>), StatusCode> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut todos = todos.lock().unwrap();
    let todo = Todo { id: todos.len() + 1, title };
    todos.push(todo.clone());
    Ok((StatusCode::CREATED, Json(todo)))
}
`,
    files: {
      'index.html': APP_PAGE('Rust · axum'),
      'Cargo.toml': `[package]
name = "todo"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
serde = { version = "1", features = ["derive"] }
`,
      'README.md': readme('Todo app · Rust', 'cargo run', 'src/main.rs'),
    },
  },
  {
    id: 'app-sinatra',
    name: 'Ruby · Sinatra app',
    description: 'A full app on Sinatra and Puma: a page and a JSON API in a dozen lines',
    language: 'ruby',
    filename: 'app.rb',
    code: `require 'sinatra'
require 'json'

TODOS = [{ id: 1, title: 'Try the live preview' }]

get '/' do
  send_file File.join(__dir__, 'index.html')
end

get '/api/todos' do
  content_type :json
  TODOS.to_json
end

post '/api/todos' do
  title = (JSON.parse(request.body.read)['title'] rescue '').to_s.strip
  halt 400, { error: 'title is required' }.to_json if title.empty?
  todo = { id: TODOS.size + 1, title: title }
  TODOS << todo
  status 201
  content_type :json
  todo.to_json
end
`,
    files: {
      'index.html': APP_PAGE('Ruby · Sinatra'),
      Gemfile: `source 'https://rubygems.org'

gem 'sinatra', '~> 4.0'
gem 'rackup', '~> 2.1'
gem 'puma', '~> 6.4'
`,
      'README.md': readme('Todo app · Sinatra', 'bundle install && bundle exec ruby app.rb', 'app.rb'),
    },
  },
  {
    id: 'app-php',
    name: 'PHP app',
    description: 'A full app in plain PHP: routing, a JSON API and a page, with no framework and no build',
    language: 'php',
    filename: 'index.php',
    code: `<?php
// Every request comes here (PHP's built-in server); edits show on the next request.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$store = sys_get_temp_dir() . '/aha-todos-' . md5(__DIR__) . '.json';
$todos = file_exists($store) ? json_decode(file_get_contents($store), true) : [['id' => 1, 'title' => 'Try the live preview']];

function json_out($value, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($value);
}

if ($path === '/api/todos' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    json_out($todos);
} elseif ($path === '/api/todos' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $title = trim(json_decode(file_get_contents('php://input'), true)['title'] ?? '');
    if ($title === '') {
        json_out(['error' => 'title is required'], 400);
        return;
    }
    $todo = ['id' => count($todos) + 1, 'title' => $title];
    $todos[] = $todo;
    file_put_contents($store, json_encode($todos));
    json_out($todo, 201);
} else {
    readfile(__DIR__ . '/index.html');
}
`,
    files: {
      'index.html': APP_PAGE('PHP'),
      'README.md': readme('Todo app · PHP', 'php -S 127.0.0.1:8080', 'index.php'),
    },
  },
  {
    id: 'app-java',
    name: 'Java app',
    description: 'A full app in Java with only the JDK: its HTTP server, a JSON API and a page, run from source',
    language: 'java',
    filename: 'Main.java',
    code: `import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Main {
    record Todo(int id, String title) {
        String json() { return "{\\"id\\":" + id + ",\\"title\\":\\"" + title.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"}"; }
    }

    static final List<Todo> todos = new ArrayList<>(List.of(new Todo(1, "Try the live preview")));

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/api/todos", Main::todos);
        server.createContext("/", exchange -> send(exchange, 200, "text/html; charset=utf-8", Files.readString(Path.of("index.html"))));
        server.start();
        System.out.println("Listening on http://127.0.0.1:" + port + "/");
    }

    static synchronized void todos(HttpExchange exchange) throws IOException {
        if (exchange.getRequestMethod().equals("POST")) {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Matcher m = Pattern.compile("\\"title\\"\\\\s*:\\\\s*\\"((?:[^\\"\\\\\\\\]|\\\\\\\\.)*)\\"").matcher(body);
            String title = m.find() ? m.group(1).trim() : "";
            if (title.isEmpty()) {
                send(exchange, 400, "application/json", "{\\"error\\":\\"title is required\\"}");
                return;
            }
            Todo todo = new Todo(todos.size() + 1, title);
            todos.add(todo);
            send(exchange, 201, "application/json", todo.json());
            return;
        }
        send(exchange, 200, "application/json", "[" + String.join(",", todos.stream().map(Todo::json).toList()) + "]");
    }

    static void send(HttpExchange exchange, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", type);
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
`,
    files: {
      'index.html': APP_PAGE('Java · JDK HttpServer'),
      'README.md': readme('Todo app · Java', 'java Main.java', 'Main.java'),
    },
  },
  {
    id: 'app-express',
    name: 'Node.js · Express app',
    description: 'A full app on Express: a page and a JSON API, restarted on every change by node --watch',
    language: 'node',
    filename: 'server.js',
    code: `import express from 'express';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json());

const todos = [{ id: 1, title: 'Try the live preview' }];

app.get('/', (req, res) => res.sendFile(fileURLToPath(new URL('./index.html', import.meta.url))));
app.get('/api/todos', (req, res) => res.json(todos));
app.post('/api/todos', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const todo = { id: todos.length + 1, title };
  todos.push(todo);
  res.status(201).json(todo);
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, '127.0.0.1', () => console.log(\`Listening on http://127.0.0.1:\${port}/\`));
`,
    files: {
      'index.html': APP_PAGE('Node.js · Express'),
      'package.json': `${JSON.stringify({ name: 'todo-express', private: true, type: 'module', main: 'server.js', scripts: { dev: 'node --watch server.js', start: 'node server.js' }, dependencies: { express: '^5.1.0' } }, null, 2)}\n`,
      'README.md': readme('Todo app · Express', 'npm install && npm run dev', 'server.js'),
    },
  },
  {
    id: 'app-bun',
    name: 'Bun app',
    description: 'A full app on Bun.serve with routes, in TypeScript, hot-reloading with no dependencies',
    language: 'bun',
    filename: 'server.ts',
    code: `const todos = [{ id: 1, title: 'Try the live preview' }];

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT) || 8080,
  routes: {
    '/': () => new Response(Bun.file(new URL('./index.html', import.meta.url)), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/api/todos': {
      GET: () => Response.json(todos),
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { title?: unknown };
        const title = String(body.title ?? '').trim();
        if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
        const todo = { id: todos.length + 1, title };
        todos.push(todo);
        return Response.json(todo, { status: 201 });
      },
    },
  },
});

console.log(\`Listening on \${server.url}\`);
`,
    files: {
      'index.html': APP_PAGE('Bun'),
      'README.md': readme('Todo app · Bun', 'bun --hot run server.ts', 'server.ts'),
    },
  },
  {
    id: 'app-deno',
    name: 'Deno app',
    description: 'A full app on Deno.serve in TypeScript: secure by default, reloading on every change, no dependencies',
    language: 'deno',
    filename: 'main.ts',
    code: `const todos = [{ id: 1, title: 'Try the live preview' }];
const page = new URL('./index.html', import.meta.url);

Deno.serve({ hostname: '127.0.0.1', port: Number(Deno.env.get('PORT') ?? 8080) }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === '/api/todos' && req.method === 'GET') return Response.json(todos);
  if (pathname === '/api/todos' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? '').trim();
    if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
    const todo = { id: todos.length + 1, title };
    todos.push(todo);
    return Response.json(todo, { status: 201 });
  }
  return new Response(await Deno.readTextFile(page), { headers: { 'content-type': 'text/html; charset=utf-8' } });
});
`,
    files: {
      'index.html': APP_PAGE('Deno'),
      'deno.json': `${JSON.stringify({ tasks: { dev: 'deno run --watch --allow-net --allow-env --allow-read main.ts' } }, null, 2)}\n`,
      'README.md': readme('Todo app · Deno', 'deno task dev', 'main.ts'),
    },
  },
  {
    id: 'app-aspnet',
    name: 'C# · ASP.NET Core app',
    description: 'A full app on ASP.NET Core minimal APIs: typed JSON endpoints and a page',
    language: 'csharp',
    filename: 'Program.cs',
    code: `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var todos = new List<Todo> { new(1, "Try the live preview") };

app.MapGet("/", () => Results.Content(File.ReadAllText("index.html"), "text/html; charset=utf-8"));
app.MapGet("/api/todos", () => todos);
app.MapPost("/api/todos", (NewTodo input) =>
{
    var title = input.Title?.Trim() ?? "";
    if (title.Length == 0) return Results.BadRequest(new { error = "title is required" });
    var todo = new Todo(todos.Count + 1, title);
    todos.Add(todo);
    return Results.Created($"/api/todos/{todo.Id}", todo);
});

app.Run();

record Todo(int Id, string Title);
record NewTodo(string? Title);
`,
    files: {
      'index.html': APP_PAGE('C# · ASP.NET Core'),
      'Todo.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
`,
      'README.md': readme('Todo app · ASP.NET Core', 'dotnet run', 'Program.cs'),
    },
  },
  {
    id: 'app-elixir',
    name: 'Elixir · Plug app',
    description: 'A full app in Elixir on Plug and Bandit: a router, a JSON API and a page, supervised',
    language: 'elixir',
    filename: 'lib/todo/router.ex',
    code: `defmodule Todo.Router do
  use Plug.Router

  plug :match
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason
  plug :dispatch

  get "/" do
    conn
    |> put_resp_content_type("text/html")
    |> send_resp(200, File.read!("index.html"))
  end

  get "/api/todos" do
    json(conn, 200, Todo.Store.all())
  end

  post "/api/todos" do
    case String.trim(conn.body_params["title"] || "") do
      "" -> json(conn, 400, %{error: "title is required"})
      title -> json(conn, 201, Todo.Store.add(title))
    end
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp json(conn, status, value) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(value))
  end
end
`,
    files: {
      'index.html': APP_PAGE('Elixir · Plug'),
      'mix.exs': `defmodule Todo.MixProject do
  use Mix.Project

  def project do
    [app: :todo, version: "0.1.0", elixir: "~> 1.15", deps: deps()]
  end

  def application do
    [extra_applications: [:logger], mod: {Todo.Application, []}]
  end

  defp deps do
    [{:bandit, "~> 1.5"}, {:jason, "~> 1.4"}]
  end
end
`,
      'lib/todo/application.ex': `defmodule Todo.Application do
  use Application

  @impl true
  def start(_type, _args) do
    port = String.to_integer(System.get_env("PORT", "8080"))

    children = [
      Todo.Store,
      {Bandit, plug: Todo.Router, ip: {127, 0, 0, 1}, port: port}
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Todo.Supervisor)
  end
end
`,
      'lib/todo/store.ex': `defmodule Todo.Store do
  use Agent

  def start_link(_), do: Agent.start_link(fn -> [%{id: 1, title: "Try the live preview"}] end, name: __MODULE__)
  def all, do: Agent.get(__MODULE__, & &1)

  def add(title) do
    Agent.get_and_update(__MODULE__, fn todos ->
      todo = %{id: length(todos) + 1, title: title}
      {todo, todos ++ [todo]}
    end)
  end
end
`,
      'README.md': readme('Todo app · Elixir', 'mix deps.get && mix run --no-halt', 'lib/todo/router.ex'),
    },
  },
];
