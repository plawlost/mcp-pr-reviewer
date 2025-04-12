# MCP PR Reviewer

[![npm version](https://img.shields.io/npm/v/mcp-pr-reviewer.svg)](https://www.npmjs.com/package/mcp-pr-reviewer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Intelligent PR reviews powered by the Model Context Protocol and LLMs

MCP PR Reviewer analyzes GitHub Pull Requests using AI and provides detailed feedback, feature analysis, and potential issue detection, with the option to auto-approve safe changes.

<!--
<p align="center">
  <img src="https://github.com/plawlost/mcp-pr-reviewer/raw/main/docs/screenshot.png" alt="PR Reviewer Screenshot" width="700">
</p>
-->

## 🚀 Features

- **MCP GitHub Integration** - Uses Model Context Protocol to securely fetch and analyze PRs
- **Detailed Analysis** - Provides decision, summary, and key points for each PR 
- **Auto-Merge Capability** - Automatically approves and merges clean PRs
- **Customizable Models** - Select from various AI models via OpenRouter
- **Security-First Design** - Your code stays within your infrastructure

## 📋 PR Review Output

Each review provides a structured analysis:

1. **Decision** - Clear APPROVE or REJECT verdict
2. **Summary** - Brief explanation of PR changes
3. **Key Points** - 3-5 bullets covering:
   - ✨ Features added
   - ⚠️ Potential drawbacks
   - 🔒 Security considerations
   - ⚡ Performance impact
   - 💻 Code quality observations

## 🔧 Installation

```bash
# Install globally
npm install -g mcp-pr-reviewer

# Or use with npx
npx mcp-pr-reviewer
```

## 🛠️ GitHub Actions Setup

1. Create `.github/workflows/pr-review.yml`:

```yaml
name: PR Review
on:
  pull_request:
    types: [opened, reopened, synchronize]
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npx mcp-pr-reviewer
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          LLM_MODEL: ${{ secrets.LLM_MODEL || 'openrouter/optimus-alpha' }}
```

2. Add your `OPENROUTER_API_KEY` in GitHub repository secrets

## 💻 CLI Usage

```bash
# Review a specific PR
mcp-pr-reviewer analyze owner repo pr-number

# Example
mcp-pr-reviewer analyze octocat hello-world 123

# Start in server mode (for GitHub Actions)
mcp-pr-reviewer server
```

Required environment variables:
- `OPENROUTER_API_KEY`: Your API key from [OpenRouter](https://openrouter.ai)
- `GITHUB_TOKEN`: For GitHub API access (auto-provided in Actions)

Optional environment variables:
- `LLM_MODEL`: Alternative OpenRouter model (default: `openrouter/optimus-alpha`)
- `MCP_GITHUB_PORT`: Port for MCP GitHub server (default: 8080)
- `LLM_PROVIDER_PORT`: Port for LLM provider (default: 8090)

## 🧩 Architecture

The system uses two complementary components:

1. **MCP GitHub Server** - Leverages Model Context Protocol for standardized GitHub access
2. **LLM Provider** - Handles AI analysis via OpenRouter

Together, they securely analyze PR diffs, provide detailed feedback, and automate approval processes.

## ⚙️ Configuration

### Custom LLM Model

```bash
# In your terminal
export LLM_MODEL="openrouter/anthropic/claude-3-opus"
mcp-pr-reviewer analyze owner repo pr-number

# Or in GitHub Actions (repository secrets)
LLM_MODEL: openrouter/anthropic/claude-3-opus
```

### Custom Review Criteria

Edit the prompt template in your local installation:

```bash
# Find the installation
which mcp-pr-reviewer

# Edit the analyze-pr.js file in the installation directory
```

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 FAQ

**Q: What is Model Context Protocol (MCP)?**  
A: MCP is an open protocol that enables AI systems to securely access data sources and tools. We use it to integrate with GitHub securely.

**Q: Does it support private repositories?**  
A: Yes, when the proper GitHub token with appropriate permissions is provided.

**Q: Can I use a different LLM provider?**  
A: Yes, by modifying the `baseURL` in the LLM provider script to point to your provider.

**Q: What LLM models work best?**  
A: Models with strong code understanding like Claude 3 Opus or Optimus Alpha work well for PR reviews.

**Q: How does this differ from other code review tools?**  
A: MCP PR Reviewer provides deeper analysis beyond syntax checking, focusing on logic, architecture, and potential issues.
