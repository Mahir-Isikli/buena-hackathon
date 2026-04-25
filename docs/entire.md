# Entire.io

Open source developer platform that captures AI coding agent sessions and links them to your git commits. The "why" behind every change, stored in your repo.

- Site: `https://entire.io`
- Docs: `https://docs.entire.io`
- LLM index: `https://docs.entire.io/llms.txt`
- GitHub org: `https://github.com/entireio` (CLI: `entireio/cli`, written in Go, MIT)

## What it actually does

You install a small CLI that hooks into your AI agent (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, GitHub Copilot CLI, Factory Droid). When you commit, Entire takes the agent's full session transcript (prompts, responses, tool calls, file diffs, token usage) and writes a "checkpoint" to a special branch in your repo. The commit message gets a trailer like `Entire-Checkpoint: a3b2c4d5e6f7` so any commit can be traced back to the conversation that produced it.

So yes, it touches your GitHub repo, but only the dedicated branch `entire/checkpoints/v1` plus shadow branches `entire/<session>-<id>`. Your main code is never modified by Entire.

## Why use it

- See the prompt and reasoning behind any commit.
- Resume an agent session from any commit (`entire rewind`, `entire explain`).
- Share context with teammates so the AI doesn't restart from zero.
- Track human vs agent line attribution per commit.

## Install and set up

```bash
curl -fsSL https://entire.io/install.sh | sh
cd your-repo
entire init                       # installs git hooks
entire configure                  # picks an agent, installs agent hooks
```

You can also enable Entire on a repo from the web app:
1. Go to entire.io and sign in with GitHub.
2. Authorize the Entire GitHub App.
3. Pick the repos you want synced. Sessions show up in the dashboard.

The GitHub App is read+write for the checkpoints branch only. Code is never modified.

## Core concepts

- **Session**: one conversation with an agent. Captures transcript, file changes, tool calls, tokens, timestamps, and nested sub-agents.
- **Checkpoint**: a snapshot you can rewind to, identified by a 12-char hex ID. Two flavors:
  - Temporary on shadow branches during the session.
  - Committed when you `git commit`, metadata persisted to `entire/checkpoints/v1`.
- **Branches**:
  - `entire/<session>-<id>` shadow branches, local only, auto-cleaned.
  - `entire/checkpoints/v1` permanent metadata, pushed with `git push`.
- **Commit trailers**:
  ```
  Entire-Checkpoint: a3b2c4d5e6f7
  Entire-Attribution: 73% agent (146/200 lines)
  ```

## CLI commands

| Command | What it does |
|---|---|
| `entire init` | Install git hooks in this repo |
| `entire configure` | Pick agents and install their hooks |
| `entire enable` | Enable an agent or set a checkpoint remote |
| `entire attach <session-id> -a <agent>` | Manually attach a session that wasn't auto-captured |
| `entire sessions` | List/inspect tracked sessions |
| `entire sessions info` | Agent, model, timing, tokens, files |
| `entire explain <ref>` | AI-generated summary of a commit/session |
| `entire rewind` | Restore a checkpoint |
| `entire clean` | Remove local Entire data |

## Supported agents

Built-in: Claude Code, Codex (preview), Copilot CLI, Cursor, Factory Droid, Gemini CLI, OpenCode.

External plugins: any binary on `$PATH` named `entire-agent-<name>` that speaks the External Agent Protocol (subcommand-based JSON over stdin/stdout). See `https://docs.entire.io/cli/external-agents`.

## Web app at entire.io

- Dashboard: aggregate AI activity and metrics.
- Repositories: connected GitHub repos.
- Checkpoints: browse by branch, see code change + transcript side by side.
- Sessions: full transcripts, tool calls, line attribution, token usage.
- Profile: account settings, API key.

## REST API

There is an OpenAPI spec at `https://docs.entire.io/api-reference/openapi.json`. The API key you have is for that surface, not the CLI itself (the CLI authenticates via the GitHub App on push). Use it when you want to programmatically:

- list connected repositories
- pull session and checkpoint data for analytics
- trigger or read explanations
- integrate Entire data into dashboards or other tools

Auth uses a bearer token in the `Authorization` header. Treat it like a GitHub PAT.

## Auto-summarize

Entire can auto-write an AI summary on each commit (accomplishments, decisions, files). Requires Claude CLI installed and authenticated. Enable in `.entire/settings.json`:

```json
{
  "strategy_options": {
    "summarize": { "enabled": true }
  }
}
```

## Checkpoint remote (optional)

If you don't want checkpoint data on the same repo as your code:

```bash
entire enable --checkpoint-remote github:myorg/checkpoints-private
```

Only `github` is supported today. Fork pushes to private org checkpoint repos are blocked. If the remote is unreachable, the main `git push` still succeeds and Entire warns you.

## Privacy and data

- Session data is encrypted at rest on entire.io.
- Sensitive tokens in transcripts are auto-anonymized (best effort, review before sharing).
- You can delete sessions any time.
- All metadata lives on a branch in your repo, so you keep ownership.

## GitLab squash-merge gotcha

GitLab squash merges may drop the `Entire-Checkpoint` trailer. Set the squash commit message template to:

```
%{title} (%{reference})

%{all_commits}
```

## TLDR for your project

- It's not a code reviewer or scanner. It records the conversation that produced the code.
- Yes, it touches your GitHub repo, but only via the `entire/checkpoints/v1` branch and signed commit trailers.
- Your `pio_sk_`-style key is for the CLI/agent; the Entire API key you mentioned is for the REST API on entire.io. Save it as `ENTIRE_API_KEY` in `.env.local` and use it with `Authorization: Bearer $ENTIRE_API_KEY` against the OpenAPI surface.
