# NanoCLI Studio

> **Zero-Runtime TypeScript CLI Generator**

Write TypeScript in your browser → Get native binaries in seconds. No Node. No npm. No dependencies. Just 178KB of pure, instant performance.

[![CI/CD Pipeline](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml)
[![Docker Build](https://github.com/BrandDeb/Aha/actions/workflows/docker-build.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/docker-build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![scriptc](https://img.shields.io/badge/Powered%20by-scriptc-00d4ff.svg)](https://scriptc.dev)

---

## 🚀 Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/BrandDeb/Aha.git
cd Aha

# Install dependencies
npm install

# Start the development server
npm run dev

# Open in browser
# http://localhost:3000
```

### Production Deployment

#### Option 1: Docker (Recommended)

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or manually
docker build -t nano-cli-studio .
docker run -p 3000:3000 nano-cli-studio
```

#### Option 2: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

#### Option 3: Standalone Node.js

```bash
# Build
npm run build

# Start server
node server.js
```

---

## ✨ Features

### 🎯 Core Features

| Feature | Description |
|---------|-------------|
| **Monaco Editor** | Full-featured TypeScript editor with IntelliSense |
| **Multi-Target Compilation** | Native binaries, C code, LLVM IR, WASM |
| **Cross-Platform** | Linux (x64, arm64), macOS (x64, arm64), Windows (x64) |
| **Real-time Collaboration** | WebSocket-based multi-user editing |
| **GitHub Integration** | Save/load projects from GitHub repositories |
| **Live Terminal** | Built-in terminal emulator for testing |
| **Project Management** | Multi-file project support |
| **AI Gateway** | Route LLM requests to fastest providers |
| **Auth Middleware** | JWT/API key validation at the edge |
| **URL Shortener** | Zero-database URL shortening |

### 📊 Performance Metrics

| Metric | NanoCLI | Node.js | Improvement |
|--------|---------|---------|-------------|
| Cold Start | ~2ms | 35-100ms | **10-50x faster** |
| Binary Size | ~178KB | 10MB+ | **100x smaller** |
| Memory Usage | ~1-4MB | 60-100MB | **15-25x less** |
| Dependencies | 0 | 100+ | **Zero dependencies** |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                         │
├─────────────────────────────────────────────────────────────┤
│  • Next.js 16 (App Router)                                   │
│  • Monaco Editor (@monaco-editor/react)                     │
│  • WebSocket Client (websocket)                              │
│  • Tailwind CSS v4                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Server (Node.js)                          │
├─────────────────────────────────────────────────────────────┤
│  • Express.js (WebSocket + API)                              │
│  • scriptc Compiler                                           │
│  • GitHub OAuth (@octokit)                                   │
│  • File Download Endpoints                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Compilation                              │
├─────────────────────────────────────────────────────────────┤
│  • scriptc CLI (TypeScript → LLVM)                           │
│  • clang-wrapper.sh (Cross-platform support)               │
│  • wasm-builder.sh (WASM compilation)                       │
│  • Output: Native, C, LLVM IR, WASM                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
Aha/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main IDE
│   │   ├── landing/page.tsx      # Marketing landing page
│   │   ├── onboarding/page.tsx   # Onboarding flow
│   │   ├── unified/page.tsx      # All features unified
│   │   ├── studio/page.tsx       # Original 5-feature studio
│   │   └── api/                  # API routes
│   │       ├── compile/route.ts  # Compilation API
│   │       ├── download/route.ts # File downloads
│   │       └── github/           # GitHub OAuth routes
│   ├── edge/
│   │   └── index.ts              # WASM edge entry point
│   ├── lib/
│   │   ├── compiler.ts           # Server-side compiler
│   │   ├── compiler-browser.ts  # Browser compiler
│   │   ├── github.ts            # GitHub utilities
│   │   ├── websocket.ts         # WebSocket manager
│   │   └── utils.ts             # Shared utilities
│   └── types/
│       └── index.ts              # TypeScript types
├── server.js                     # WebSocket server
├── clang-wrapper.sh              # Cross-platform compiler wrapper
├── wasm-builder.sh               # WASM compilation script
├── Dockerfile                    # Production Docker image
├── docker-compose.yml            # Docker orchestration
├── nginx.conf                    # Nginx reverse proxy
├── .github/workflows/            # GitHub Actions
│   ├── ci-cd.yml                # CI/CD pipeline
│   ├── release.yml              # Release automation
│   └── docker-build.yml          # Docker builds
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎨 Pages

### `/` - Main IDE
The primary NanoCLI Studio interface with:
- Monaco Editor
- Compilation controls
- Terminal emulator
- Project explorer
- Real-time collaboration

### `/landing` - Marketing Landing Page
Modern, highly-styled landing page with:
- Hero section
- Live demo
- Features grid
- Pricing tiers
- Testimonials
- FAQ section

### `/onboarding` - Onboarding Flow
5-step interactive onboarding:
1. Welcome
2. User information
3. Template selection
4. Interface tour
5. Completion

### `/unified` - Unified Studio
All 7 features in one interface:
- Editor
- Projects
- Terminal
- AI Gateway
- Auth Middleware
- URL Shortener
- Markdown Editor
- Analytics

### `/studio` - Original Studio
The initial 5-feature studio:
- AI Gateway
- Auth Middleware
- URL Shortener
- Markdown Editor
- Analytics Dashboard

---

## 🔧 Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Application
NODE_ENV=development
PORT=3000
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# GitHub OAuth (for GitHub integration)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_REDIRECT_URI=http://localhost:3000/api/github/callback

# WebSocket
NEXT_PUBLIC_WS_URL=ws://localhost:3000
# Origins allowed to open collaboration sockets (comma separated).
# Defaults to NEXT_PUBLIC_BASE_URL; same-origin connections are always allowed.
WS_ALLOWED_ORIGINS=http://localhost:3000

# scriptc (C compiler used by scriptc; SCRIPTC_CC=zigcc enables the WASM target)
SCRIPTC_CC=clang
```

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set the callback URL to `http://localhost:3000/api/github/callback`
4. Copy the Client ID and Client Secret to your `.env` file

---

## 🚀 Usage Examples

### Basic CLI

```typescript
// app.ts
const args = process.argv.slice(2);
const name = args[0] || 'World';

console.log(`Hello, ${name}!`);
```

Compile and run:
```bash
# Compile to native binary
./app-linux Alice
# Output: Hello, Alice!

# Compile to C code
# View the generated C code

# Compile to WASM
# Use in browser or WASM runtimes
```

### HTTP Server

```typescript
// server.ts
import { createServer } from 'http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from NanoCLI Server!');
});

const port = parseInt(process.argv[2] || '3000');
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

### File Processor

```typescript
// processor.ts
import { readFileSync, writeFileSync } from 'fs';

const inputFile = process.argv[2];
const outputFile = process.argv[3];

const content = readFileSync(inputFile, 'utf8');
const processed = content.toUpperCase();
writeFileSync(outputFile, processed);

console.log(`Processed ${inputFile} -> ${outputFile}`);
```

---

## 🔌 API Endpoints

### Compilation

```
POST /api/compile
```

Request:
```json
{
  "code": "const x = 5; console.log(x);",
  "filename": "app.ts",
  "target": "exe",
  "platform": "linux"
}
```

Response:
```json
{
  "success": true,
  "output": "...",
  "filename": "3f2a…-app",
  "downloadUrl": "/api/download/3f2a…-app"
}
```

- `target`: `exe` | `c` | `llvm` | `wasm`; `platform`: `linux` | `macos` | `windows`; `arch`: `x64` | `arm64`.
  Unknown values are rejected with `400`.
- `exe` builds for the server's own platform/arch (scriptc does not cross-compile); use `c` or `llvm` to build elsewhere.
- `wasm` needs a wasm32-wasi C toolchain (`SCRIPTC_CC=zigcc`); otherwise LLVM IR is returned as a fallback.
- Source is limited to 512 KB, each toolchain step to 60 s. Build artifacts older than an hour are pruned.

### GitHub OAuth

```
GET /api/github/auth      # Initiate OAuth flow
GET /api/github/callback  # OAuth callback
GET /api/github/user      # Get user info
DELETE /api/github/user   # Log out
GET /api/github/repos     # Get user repositories

GET /api/github/repos/:owner/:repo/contents?path=<dir>   # List a directory
GET /api/github/repos/:owner/:repo/file?path=<file>      # Read a file -> { content, sha }
PUT /api/github/repos/:owner/:repo/file                  # Commit a file
    { "path": "src/app.ts", "content": "...", "message": "optional", "sha": "required when updating" }
```

In `/studio`, **Browse Repos** opens a repository/directory browser; picking a file loads it into the
editor, and **Commit to GitHub** writes the editor contents back (to the loaded file, or to the current
filename inside the folder you browsed to).

### File Download

```
GET /api/download/<filename>
GET /api/download?filename=<filename>
```

---

## 🐳 Docker

### Build Image

```bash
# Build production image
docker build -t nano-cli-studio .

# Build with multi-platform support
docker buildx build --platform linux/amd64,linux/arm64 -t nano-cli-studio . --push
```

### Run Container

```bash
# Basic run
docker run -p 3000:3000 nano-cli-studio

# With environment variables
docker run -p 3000:3000 \
  -e GITHUB_CLIENT_ID=your_id \
  -e GITHUB_CLIENT_SECRET=your_secret \
  nano-cli-studio

# With volume for temp files
docker run -p 3000:3000 -v ./temp:/app/temp nano-cli-studio
```

### Docker Compose

```bash
# Start all services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f
```

---

## 📦 Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run start:next` | Start Next.js server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Run unit tests (Node.js 22+ test runner) |
| `npm run scriptc:build` | Build with scriptc |
| `npm run scriptc:wasm` | Build WASM target |
| `npm run scriptc:native` | Build native target |
| `npm run docker:build` | Build Docker image |
| `npm run docker:up` | Start Docker containers |
| `npm run docker:down` | Stop Docker containers |
| `npm run clean` | Clean build artifacts |

---

## 🤖 AI Gateway

Route LLM requests to the fastest/cheapest provider:

```typescript
// Supported providers
- openrouter
- groq
- firebase
- anthropic
- mistral

// Features
- ~2ms cold starts
- Latency-based routing
- A/B testing support
- Real-time monitoring
```

---

## 🔐 Auth Middleware

Validate JWTs, API keys, and OAuth tokens at the edge:

```typescript
// Features
- ~1ms validation
- Multiple token types
- No node:crypto dependency
- Deploy to any edge runtime
```

---

## 🔗 URL Shortener

Zero-database URL shortener with KV storage:

```typescript
// Features
- Custom domains
- Analytics (click counts)
- Expiration support
- Password protection
```

---

## 📝 Markdown Editor

Offline-first markdown editor:

```typescript
// Features
- Live preview
- Multiple notes
- Tag support
- Auto-save
- Full-text search
```

---

## 📊 Analytics Dashboard

Real-time monitoring:

```typescript
// Metrics
- Total requests
- Average latency
- Requests by type
- Requests by provider
- Performance stats
```

---

## 🛠 Development

### Prerequisites

- Node.js 18+ 
- npm 9+
- Docker (optional)
- clang/LLVM (for native compilation)

### Install Dependencies

```bash
npm install
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [scriptc](https://scriptc.dev) - The revolutionary TypeScript compiler
- [Next.js](https://nextjs.org) - The React Framework
- [Monaco Editor](https://microsoft.com/monaco-editor) - Code editor for the web
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS framework
- [Vercel](https://vercel.com) - Deployment platform

---

## 📞 Support

- **Documentation**: [docs.nano.cli](https://docs.nano.cli)
- **GitHub**: [BrandDeb/Aha](https://github.com/BrandDeb/Aha)
- **Twitter**: [@nano_cli](https://twitter.com/nano_cli)
- **Discord**: [discord.gg/nano-cli](https://discord.gg/nano-cli)
- **Email**: hello@nano.cli

---

<p align="center">
  Built with ❤️ using <a href="https://scriptc.dev">scriptc</a>
</p>
