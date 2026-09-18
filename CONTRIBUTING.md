# Contributing to Rivet

Thank you for your interest in contributing to Rivet! This document outlines how to get started, our coding standards, and the contribution process.

---

## 🏗️ Project Setup

### Prerequisites

- **Node.js** >= 20.x
- **pnpm** >= 9.x
- **Git** >= 2.40
- **Docker** & **Docker Compose** (for local databases and IPFS)
- A **crypto wallet** (MetaMask, JoyID, or UniSat) for testing CKB features

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/rivet.git
cd rivet

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env

# Start local services (PostgreSQL, IPFS, CKB devnet)
docker compose up -d

# Run database migrations
pnpm db:migrate

# Start the development servers
pnpm dev
```

This starts:
- Web platform: `http://localhost:3000`
- API server: `http://localhost:4000`
- PostgreSQL: `localhost:5432`
- IPFS: `localhost:5001`

---

## 📁 Repository Structure

```
Rivet/
├── apps/
│   ├── web/          # Next.js web platform
│   └── cli/          # CLI tool
├── packages/
│   ├── core/         # Shared business logic
│   ├── git-engine/   # Git operations
│   ├── ckb-client/   # CKB/RGB++ transactions
│   └── storage/      # IPFS/Arweave adapters
├── docs/             # Project documentation
└── docker/           # Docker configurations
```

---

## 🔀 Git Workflow

### Branch Naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `refactor/description` — Code refactoring
- `test/description` — Adding tests

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add wallet connection via CCC
fix: resolve IPFS upload timeout on large repos
docs: update API spec with restore endpoints
refactor: extract Merkle tree computation into package
test: add unit tests for email remapping
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Write tests for new features
5. Run `pnpm lint && pnpm test` to ensure everything passes
6. Submit a pull request with a clear description

---

## 📝 Coding Standards

### TypeScript

- **Strict mode** enabled everywhere
- Use `interface` for object shapes, `type` for unions/intersections
- No `any` types — use `unknown` when type is truly unknown
- All public functions must have JSDoc comments

### CSS

- Use CSS Modules for component-level styles
- Use CSS custom properties (variables) for theming
- No CSS frameworks (no Tailwind) — vanilla CSS only
- Mobile-first responsive design

### File Naming

- Components: `PascalCase.tsx` (e.g., `RepoCard.tsx`)
- Utilities: `camelCase.ts` (e.g., `computeMerkle.ts`)
- Styles: `ComponentName.module.css`
- Tests: `filename.test.ts`
- Types: co-located in `types.ts` files

---

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @rivet/core test

# Run tests in watch mode
pnpm test:watch

# Run linting
pnpm lint
```

---

## 📖 Documentation

When contributing, please update relevant documentation:

- **New API endpoint?** → Update `docs/API_SPEC.md`
- **New user flow?** → Update `docs/USER_FLOWS.md`
- **Architecture change?** → Update `docs/ARCHITECTURE.md`
- **New data model?** → Update `docs/DATA_MODELS.md`
- **CKB integration change?** → Update `docs/CKB_INTEGRATION.md`

---

## 🤝 Code of Conduct

- Be respectful and constructive
- Welcome newcomers
- Focus on the code, not the person
- No tolerance for harassment or discrimination

---

## 💬 Getting Help

- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **CKB Dev Community**: Join the [Nervos Talk forum](https://talk.nervos.org/) for CKB-specific help

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.
