#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  Salesforce MCP — Interactive Setup Script
#  Uses native macOS dialogs (osascript) for
#  all interactive prompts — zero dependencies.
# ─────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_success() { echo -e "${GREEN}  ✓ $1${RESET}"; }
print_warn()    { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
print_error()   { echo -e "${RED}  ✗ $1${RESET}"; }
print_info()    { echo -e "    $1"; }

# ─────────────────────────────────────────────
#  Native macOS dialog helpers
# ─────────────────────────────────────────────

dialog_choose() {
  local prompt="$1"
  shift
  local items=""
  for item in "$@"; do
    if [[ -n "$items" ]]; then
      items="$items, \"$item\""
    else
      items="\"$item\""
    fi
  done

  osascript -e "
    set choices to choose from list {${items}} ¬
      with prompt \"${prompt}\" ¬
      with multiple selections allowed
    if choices is false then
      return \"\"
    else
      set AppleScript's text item delimiters to \"\n\"
      return choices as text
    end if
  " 2>/dev/null
}

dialog_confirm() {
  local prompt="$1"
  osascript -e "
    try
      display dialog \"${prompt}\" buttons {\"No\", \"Yes\"} default button \"No\" with icon note
      if button returned of result is \"Yes\" then
        return \"yes\"
      else
        return \"no\"
      end if
    on error
      return \"no\"
    end try
  " 2>/dev/null
}

dialog_alert() {
  local title="$1"
  local message="$2"
  osascript -e "
    display dialog \"${message}\" buttons {\"OK\"} default button \"OK\" with title \"${title}\" with icon stop
  " 2>/dev/null || true
}

# ─────────────────────────────────────────────
#  Phase 1: Prerequisite checks
# ─────────────────────────────────────────────

check_prerequisites() {
  echo ""
  echo -e "${CYAN}${BOLD}  Checking prerequisites...${RESET}"
  echo ""

  # Node.js
  if ! command -v node &>/dev/null; then
    print_error "Node.js is not installed."
    print_info ""
    print_info "  Option A (macOS with Homebrew):  brew install node"
    print_info "  Option B (all platforms):        https://nodejs.org"
    echo ""
    dialog_alert "Missing Prerequisite" \
      "Node.js is not installed.\n\nPlease install it from https://nodejs.org (version 18 or higher) and then re-run this script."
    exit 1
  fi

  NODE_OK=$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
  if [[ "$NODE_OK" == "old" ]]; then
    local node_ver
    node_ver=$(node --version)
    print_error "Node.js ${node_ver} is too old — version 18 or higher is required."
    dialog_alert "Node.js Too Old" \
      "Your Node.js version (${node_ver}) is too old.\n\nPlease update to version 18 or higher from https://nodejs.org and re-run this script."
    exit 1
  fi

  print_success "Node.js $(node --version)"

  # Salesforce CLI
  if ! command -v sf &>/dev/null; then
    print_error "Salesforce CLI (sf) is not installed."
    print_info ""
    print_info "  Run:  npm install -g @salesforce/cli"
    print_info "  Docs: https://developer.salesforce.com/tools/salesforcecli"
    echo ""
    dialog_alert "Missing Prerequisite" \
      "The Salesforce CLI (sf) is not installed.\n\nOpen Terminal and run:\n\n  npm install -g @salesforce/cli\n\nThen re-run this script."
    exit 1
  fi

  print_success "Salesforce CLI $(sf --version 2>/dev/null | head -1)"
  echo ""
}

# ─────────────────────────────────────────────
#  Phase 2: Install & Build
# ─────────────────────────────────────────────

install_and_build() {
  cd "$SCRIPT_DIR"

  echo -e "${CYAN}${BOLD}  Installing dependencies...${RESET}"
  npm install --silent 2>&1
  print_success "Dependencies installed"

  if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    print_success "Created .env from .env.example"
  else
    print_success ".env already exists — skipping"
  fi

  echo ""
  echo -e "${CYAN}${BOLD}  Building the project...${RESET}"
  npm run build --silent 2>&1
  print_success "Build complete"
  echo ""
}

# ─────────────────────────────────────────────
#  Phase 3: MCP Client configuration
# ─────────────────────────────────────────────

configure_cursor() {
  local server_path="$SCRIPT_DIR/dist/index.js"
  local config_file="$HOME/.cursor/mcp.json"
  mkdir -p "$(dirname "$config_file")"

  node -e "
    const fs = require('fs');
    const p = '$config_file';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers.salesforce = { command: 'node', args: ['$server_path'] };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  "
  print_success "Cursor configured"
  print_info "Restart Cursor, then look for the MCP tools icon in the chat panel."
}

configure_claude_code() {
  local server_path="$SCRIPT_DIR/dist/index.js"

  if ! command -v claude &>/dev/null; then
    print_warn "Claude Code CLI not found on PATH."
    print_info "Add it manually once installed:"
    print_info "  claude mcp add salesforce -- node \"$server_path\""
    return
  fi

  claude mcp add salesforce -- node "$server_path"
  print_success "Claude Code configured"
  print_info "Start a new Claude Code session — tools will be available automatically."
}

configure_claude_desktop() {
  local server_path="$SCRIPT_DIR/dist/index.js"

  if [[ "$(uname)" != "Darwin" ]]; then
    print_warn "Auto-config for Claude Desktop only works on macOS."
    print_info "On Windows, add this manually to %APPDATA%\\Claude\\claude_desktop_config.json:"
    print_info "  \"salesforce\": { \"command\": \"node\", \"args\": [\"$server_path\"] }"
    return
  fi

  local config_file="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  mkdir -p "$(dirname "$config_file")"

  node -e "
    const fs = require('fs');
    const p = '$config_file';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers.salesforce = { command: 'node', args: ['$server_path'] };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  "
  print_success "Claude Desktop / Cowork configured"
  print_info "Quit and reopen Claude Desktop — tools will appear automatically."
}

choose_clients() {
  echo -e "${CYAN}${BOLD}  Select your AI client(s)...${RESET}"
  echo ""

  local CLIENTS
  CLIENTS=$(dialog_choose \
    "Which AI client(s) would you like to configure? (You can select more than one)" \
    "Cursor" \
    "Claude Code" \
    "Claude Desktop / Cowork" \
  )

  if [[ -z "$CLIENTS" ]]; then
    print_warn "No client selected. Re-run setup.sh anytime to configure one."
    echo ""
    return
  fi

  echo ""

  if echo "$CLIENTS" | grep -q "Cursor"; then
    configure_cursor
    echo ""
  fi

  if echo "$CLIENTS" | grep -q "Claude Code"; then
    configure_claude_code
    echo ""
  fi

  if echo "$CLIENTS" | grep -q "Claude Desktop"; then
    configure_claude_desktop
    echo ""
  fi
}

# ─────────────────────────────────────────────
#  Phase 4: Optional Salesforce authentication
# ─────────────────────────────────────────────

maybe_authenticate() {
  local answer
  answer=$(dialog_confirm \
    "Would you like to log in to Salesforce now?\n\nThis will open your browser to the WillowTree login page.\n\nIf you skip this, you'll be prompted the first time you use a tool." \
  )

  if [[ "$answer" == "yes" ]]; then
    echo ""
    echo -e "${CYAN}${BOLD}  Opening Salesforce login in your browser...${RESET}"
    print_info "Complete the login there and come back here."
    echo ""
    SF_INSTANCE_URL="${SALESFORCE_INSTANCE_URL:-https://willowtree.my.salesforce.com}"
    sf org login web --instance-url "$SF_INSTANCE_URL" --alias willowtree
    echo ""
    print_success "Authentication complete — your session is ready."
  else
    echo ""
    print_info "Skipped. You'll be prompted to log in on your first tool call."
  fi

  echo ""
}

# ─────────────────────────────────────────────
#  Phase 5: Summary
# ─────────────────────────────────────────────

print_summary() {
  echo -e "${GREEN}${BOLD}  ══════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}    Setup complete!${RESET}"
  echo -e "${GREEN}${BOLD}  ══════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  You're all set. Open your AI client and try asking:"
  echo ""
  echo -e "    ${CYAN}• \"What projects am I currently on?\"${RESET}"
  echo -e "    ${CYAN}• \"Show me the revenue forecast for this quarter.\"${RESET}"
  echo -e "    ${CYAN}• \"Who are the bench resources available right now?\"${RESET}"
  echo -e "    ${CYAN}• \"What are my missing timecards?\"${RESET}"
  echo ""
  echo -e "  ${BOLD}Session expired?${RESET}  Tell your assistant: ${CYAN}reconnect${RESET}"
  echo -e "  ${BOLD}Re-run setup?${RESET}     Run: ${CYAN}bash setup.sh${RESET}"
  echo ""
}

# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

main() {
  echo ""
  echo -e "${CYAN}${BOLD}  ══════════════════════════════════════════${RESET}"
  echo -e "${CYAN}${BOLD}    Salesforce MCP — Setup${RESET}"
  echo -e "${CYAN}${BOLD}  ══════════════════════════════════════════${RESET}"
  echo ""

  check_prerequisites
  install_and_build
  choose_clients
  maybe_authenticate
  print_summary
}

main
