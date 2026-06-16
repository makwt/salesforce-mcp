# Salesforce MCP — Setup Guide

A step-by-step guide to get the WillowTree Salesforce MCP running on your Mac and connected to your AI assistant (Claude Code or Claude Desktop / Cowork).

No prior coding experience needed. Just follow each step in order.

Estimated time: **20–30 minutes**, mostly waiting for installers.

---

## Before you start — one-time setup

You will need three things before running the technical steps:

1. **A GitHub account** (free)
2. **Access to the WillowTree Salesforce MCP repository** (granted by Ahmed or a repo admin)
3. **About 30 minutes of uninterrupted time**

### A. Create a GitHub account

1. Open your browser and go to **https://github.com/signup**
2. Use your **WillowTree work email** (so we can add you to our org easily).
3. Pick a username, set a password, and verify your email.
4. Once you're logged in, **send Ahmed your GitHub username** so he can grant you access to the `willowtreeapps/salesforce-mcp` repository.
5. **Wait for the invitation email from GitHub** — it will be titled "You've been invited to join the willowtreeapps organization". Click the **"Accept invitation"** button inside that email before continuing.

> If the email never arrives, check your spam folder, then ask Ahmed to re-send the invite.

### B. Open Terminal

You'll run several commands in a program called **Terminal** that comes pre-installed on every Mac.

1. Press **`Command (⌘) + Space`** to open Spotlight.
2. Type **`Terminal`** and press **Enter**.
3. A black or white window will open with a blinking cursor. That's where you'll paste the commands below.

Tip: copy each command block by clicking the copy icon (or selecting the text), then in Terminal press **`Command (⌘) + V`** to paste, and **Enter** to run.

---

## Step 1 — Install Homebrew

Homebrew is a free tool that lets you install other software with one line. We need it to install Node, Git, and a few other things.

Paste this into Terminal and press Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

You will be asked for your **Mac login password** — type it (you won't see any characters appear; that's normal) and press Enter. The installer will take **5–10 minutes**.

When it finishes, it will print a section called **"Next steps"** with two commands you must run. They will look something like this (your version may vary slightly — **copy what your screen shows, not what's below**):

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> /Users/$(whoami)/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Run both of those in order, then verify Homebrew is working:

```bash
brew --version
```

You should see a version number (e.g. `Homebrew 4.x.x`). If you do, you're good.

---

## Step 2 — Install Git, Node, GitHub CLI, and Salesforce CLI

One command installs everything we need:

```bash
brew install git node gh
```

This will take **3–5 minutes**. Wait for it to finish completely.

Then install the Salesforce CLI:

```bash
npm install -g @salesforce/cli
```

Verify everything is installed:

```bash
git --version
```

```bash
node --version
```

```bash
gh --version
```

```bash
sf --version
```

Each command should print a version number. If any of them says "command not found", close Terminal, reopen it, and try again.

---

## Step 3 — Sign in to GitHub through your browser

This connects your Terminal to your GitHub account so you can download the project. The login happens in your browser — no passwords typed into Terminal.

Run:

```bash
gh auth login --web --hostname github.com --git-protocol https
```

You'll be asked one question:

> **Authenticate Git with your GitHub credentials? (Y/n)**

Type **`Y`** and press Enter.

Next, Terminal will display something like:

```
! First copy your one-time code: XXXX-XXXX
Press Enter to open github.com in your browser...
```

1. **Copy the one-time code** shown on your screen (highlight it and press `Command + C`).
2. Press **Enter** in Terminal.
3. Your browser will open to a GitHub page asking for the code. **Paste it** and click **Continue**.
4. Approve the access by clicking **Authorize github**.
5. Return to Terminal — it will say `✓ Authentication complete.`

Now connect Git itself to your GitHub login. This tells Git to use `gh` whenever it needs to authenticate to GitHub — so `git clone` and `git pull` "just work" without ever asking for a password.

```bash
gh auth setup-git
```

It will print nothing on success — that's correct.

Verify everything is connected:

```bash
gh auth status
```

You should see your GitHub username listed as logged in, plus a line that says **"Git operations protocol: https"** and **"configured to use https protocol"**.

---

## Step 4 — Download the project

Choose a folder to keep the project in. The guide uses your **Desktop** for simplicity — you can pick anywhere, but make sure to use the same path in every step below.

```bash
cd ~/Desktop
```

```bash
git clone https://github.com/willowtreeapps/salesforce-mcp.git
```

If this is your first time using git in Terminal, it may ask for your name and email. Run these two commands (replacing the placeholder values with your real name and your WillowTree email):

```bash
git config --global user.name "Your Full Name"
```

```bash
git config --global user.email "your.email@willowtreeapps.com"
```

Then re-run the clone:

```bash
git clone https://github.com/willowtreeapps/salesforce-mcp.git
```

When it finishes, move into the new folder:

```bash
cd ~/Desktop/salesforce-mcp
```

---

## Step 5 — Run the setup script

This is the one command that does all the heavy lifting — it installs dependencies, builds the project, configures your AI client, and optionally logs you into Salesforce.

```bash
bash setup.sh
```

The script will:

1. **Check prerequisites** — confirms Node and Salesforce CLI are installed (they are, from Step 2).
2. **Install and build the project** — this takes 1–2 minutes; you'll see progress in Terminal.
3. **Ask which AI client you use** — a small dialog box will pop up. Pick:
    - **Claude Desktop / Cowork** — if you use the Claude desktop app
    - **Claude Code** — if you also use the Claude Code terminal tool

   You can pick more than one by **holding Command (⌘)** while clicking each one. Click **OK**.
4. **Offer to log in to Salesforce** — another dialog box. Click **Yes**.

When you click Yes on the Salesforce login:

- Your browser opens to the WillowTree Salesforce login page.
- Log in with your normal WillowTree SSO credentials (the same ones you use for Salesforce in the browser every day).
- Approve any access prompts.
- Return to Terminal — it will say **"Authentication complete — your session is ready."**

You'll see a green **"Setup complete!"** banner.

---

## Step 6 — Restart your AI client and test

Close and reopen whichever client you configured:

- **Claude Desktop / Cowork** — quit (Cmd+Q) and reopen.
- **Claude Code** — start a brand new session in Terminal.

Then ask your AI assistant a test question, like:

> *"What projects am I currently on?"*

or

> *"Show me the revenue forecast for this quarter."*

If the assistant returns Salesforce data, you're done. 🎉

---

## Common questions

**My session expired / I get an authentication error.**
Re-authenticate at the terminal with one command, then tell your AI assistant **"reconnect"**:

```bash
sf org login web --instance-url https://willowtree.my.salesforce.com --alias willowtree
```

Your browser opens to the WillowTree Salesforce login page (same as during setup). Log in, return to Terminal, then tell your AI assistant: **"reconnect"**. It will pick up the new session without restarting anything.

**A tool call hangs / never returns a result.**
The MCP server runs over a data pipe and cannot open a browser. If it seems stuck, you are likely on an older version. Pull the latest and rebuild:

```bash
cd ~/Desktop/salesforce-mcp
git pull
bash setup.sh
```

Then restart your AI client. The server now reads your existing Salesforce CLI session silently — no browser needed after the initial setup.

**Claude Code is using the wrong Salesforce tool (not returning my data).**
Claude Code has access to several Salesforce-related tools. If it picks the wrong one, be explicit:

> *"Use the local salesforce MCP — what projects am I on?"*

The local tools are named things like `list_my_projects`, `whoami`, and `get_revenue_forecast`. If you see it trying to use "TDX Salesforce" or "WT Salesforce Sandbox", those are different cloud connectors and are unrelated to this server.

**I want to re-run setup.**
That's safe. Just navigate back to the folder and run setup again:

```bash
cd ~/Desktop/salesforce-mcp
```

```bash
bash setup.sh
```

**I want to update the project later when there are changes.**

```bash
cd ~/Desktop/salesforce-mcp
```

```bash
git pull
```

```bash
bash setup.sh
```

**Something broke / I'm stuck.**
Copy and paste whatever Terminal printed (the full error message) and send it to Ahmed. The error message is the single most useful thing for diagnosing problems.

---

## Quick command reference

If you ever lose this guide, here's the entire happy path in one block (after Homebrew is installed and GitHub access is granted):

```bash
brew install git node gh
```

```bash
npm install -g @salesforce/cli
```

```bash
gh auth login --web --hostname github.com --git-protocol https
```

```bash
gh auth setup-git
```

```bash
cd ~/Desktop
```

```bash
git clone https://github.com/willowtreeapps/salesforce-mcp.git
```

```bash
cd ~/Desktop/salesforce-mcp
```

```bash
bash setup.sh
```
