# MCP PR Reviewer

[![npm version](https://img.shields.io/npm/v/mcp-pr-reviewer.svg)](https://www.npmjs.com/package/mcp-pr-reviewer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Intelligent PR reviews powered by the Model Context Protocol and LLMs.

MCP PR Reviewer analyzes GitHub Pull Requests using AI, leveraging the Model Context Protocol for secure GitHub integration and providing detailed feedback.

## 🚀 Features

- **MCP GitHub Integration:** Securely fetches PR data using `@modelcontextprotocol/server-github`.
- **AI-Powered Analysis:** Uses configurable LLMs via OpenRouter for insightful code review.
- **Structured Feedback:** Provides a clear decision (Approve/Reject), summary, and key points.
- **CLI & Server Modes:** Usable both directly for analysis and as a server for integrations.
- **Customizable:** Choose your preferred LLM model.

## 🔧 Installation

```bash
# Install globally
npm install -g mcp-pr-reviewer

# Or use with npx without installing
npx mcp-pr-reviewer --help
```

## 💻 Usage

### Prerequisites

Set the following environment variables:

- `GITHUB_TOKEN`: Your GitHub Personal Access Token with `repo` scope.
- `OPENROUTER_API_KEY`: Your API key from [OpenRouter.ai](https://openrouter.ai).

### Analyze a Pull Request

```bash
# Format
mcp-pr-reviewer analyze <owner> <repo> <pr-number> [options]

# Example
mcp-pr-reviewer analyze octocat hello-world 123

# Example with specific ports and model
mcp-pr-reviewer analyze myorg my-repo 456 --mcp-port 8081 --llm-port 8091 --model openrouter/anthropic/claude-3-haiku
```

**Options:**
- `--mcp-port <port>`: Port for the internal MCP GitHub server (default: 8080).
- `--llm-port <port>`: Port for the internal LLM provider server (default: 8090).
- `-m, --model <model>`: Specify the OpenRouter model ID (default: `openrouter/optimus-alpha`).

### Run as a Server (for Integrations)

The `server` command starts *only* the LLM provider component, making it available as an MCP server for other tools or integrations (like GitHub Actions).

```bash
# Start the LLM Provider server
mcp-pr-reviewer server --port 8012 --model openrouter/google/gemini-pro
```

This allows external systems to call its `analyze_pr` capability.

## 🧩 MCP Configuration (Example for Cursor)

You can integrate `mcp-pr-reviewer` with tools like Cursor using an `mcp.json` file. Here's an example configuration:

```json
{
  "mcpServers": {
    "GitHub MCP": {
      "command": "npx",
      "type": "stdio",
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_GITHUB_PAT_HERE"
      },
      "args": [
        "@modelcontextprotocol/server-github"
      ]
    },
    "PR Reviewer": {
      "command": "npx",
      "type": "http",
      "baseUrl": "http://localhost:8012",
      "env": {
        "OPENROUTER_API_KEY": "YOUR_OPENROUTER_KEY_HERE"
      },
      "args": [
        "mcp-pr-reviewer",
        "server",
        "--port",
        "8012"
      ]
    }
  }
}
```

**Note:** Replace placeholders like `YOUR_GITHUB_PAT_HERE` and `YOUR_OPENROUTER_KEY_HERE` with your actual credentials.

## 🏗️ Architecture

The `analyze` command orchestrates two main components:

1.  **MCP GitHub Server:** An instance of `@modelcontextprotocol/server-github` started internally to handle secure communication with the GitHub API.
2.  **LLM Provider Server:** A simple Express server (`lib/mcp-llm-provider.js`) started internally that:
    *   Accepts analysis requests.
    *   Communicates with the OpenRouter API to get the LLM analysis.

The `lib/analyze-pr.js` script coordinates the process:
1.  Connects to the running MCP GitHub Server (via HTTP) to fetch the PR diff.
2.  Sends the diff to the running LLM Provider Server (via HTTP) for analysis.
3.  Outputs the formatted review.

The `server` command only starts the LLM Provider Server, exposing it for external MCP calls.

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a Pull Request.

1.  Fork the repository
2.  Create your feature branch (`git checkout -b feature/amazing-feature`)
3.  Commit your changes (`git commit -m 'Add some amazing feature'`)
4.  Push to the branch (`git push origin feature/amazing-feature`)
5.  Open a Pull Request

## 📜 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 FAQ

**Q: What is Model Context Protocol (MCP)?**
A: An open standard allowing AI models to securely interact with tools and data sources. See [modelcontext.dev](https://modelcontext.dev).

**Q: Does it work with private repositories?**
A: Yes, ensure your `GITHUB_TOKEN` has the necessary permissions (e.g., `repo` scope).

**Q: Can I use models other than OpenRouter?**
A: Currently, it's hardcoded for OpenRouter. Modifying `lib/mcp-llm-provider.js` would be required to support other providers.

**Q: How is this different from GitHub Copilot's PR Summary?**
A: This tool provides a more opinionated review, including an Approve/Reject decision and specific feedback points based on a configurable prompt, rather than just a summary.
