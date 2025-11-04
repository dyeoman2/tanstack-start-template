# CodeRabbit CLI Setup

CodeRabbit provides AI-powered code reviews. Install and configure the CLI for enhanced development workflow.

## Installation

1. **Install CodeRabbit CLI**:

   ```bash
   curl -fsSL https://cli.coderabbit.ai/install.sh | sh
   ```

2. **Authenticate with your CodeRabbit account**:

   ```bash
   coderabbit auth login
   ```

## Getting Started

After installation and authentication, you can start using CodeRabbit CLI for AI-powered code reviews:

```bash
# Review all changes (committed and uncommitted)
coderabbit review

# Review only uncommitted changes
coderabbit review --type uncommitted

# Review with custom AI instructions (uses CLAUDE.md if present)
coderabbit review --config CLAUDE.md

# Get plain text output (non-interactive)
coderabbit review --plain
```

## CLI Command Reference

The CodeRabbit CLI provides several options for customizing your code review experience:

- `--type <type>`: Review type - `all`, `committed`, `uncommitted` (default: "all")
- `--config <files...>`: Additional instructions for CodeRabbit AI (e.g., CLAUDE.md, coderabbit.yaml)
- `--base <branch>`: Base branch for comparison
- `--base-commit <commit>`: Base commit on current branch for comparison
- `--plain`: Output in plain text format (non-interactive)
- `--prompt-only`: Show only AI agent prompts (implies --plain)

## Integration with Your Workflow

The CLI integrates seamlessly with your development workflow and provides intelligent code review assistance. Use it to:

- Get AI-powered feedback on your code changes before committing
- Review pull requests with enhanced context and suggestions
- Maintain code quality standards across your team
- Leverage your project's CLAUDE.md file for custom AI instructions

For more information, visit the [CodeRabbit CLI documentation](https://docs.coderabbit.ai/cli).
