# Shipping the PrintQ Agent to a shop

How the Windows agent gets from this repository onto a photocopy shop's
counter PC, and why it is built the way it is.

## What the shop does

1. Opens `https://printq-rho.vercel.app/downloads/windows`
2. Clicks **Download for Windows**
3. Double-clicks `PrintQAgent-Setup.exe`
4. PrintQ Agent opens by itself
5. Types the pairing code from Dashboard → Agent
6. Picks their printer in the Printers tab

No terminal, no Python, no Node, no tunnel, no config file, no administrator
password. That list is the whole requirement; everything below exists to keep
it true.

## Why these choices

**Per-user install, no UAC.** `PrivilegesRequired=lowest` installs under the
user's own `Programs` folder. Counter PCs are often standard accounts, and an
installer that raises a prompt nobody can answer does not get installed.
Nothing needs machine-wide rights: printing happens as the logged-in user.

**A tray app on the Run key, not a Windows service.** A service runs in
session 0, isolated from the interactive desktop. Many printer drivers depend
on the user session — some queue silently, some fail, some pop UI nobody can
see. Registering under `HKCU\...\CurrentVersion\Run` with `--minimised` keeps
the agent in the same session as the printer it drives. This is the single
most important architectural decision here and it is deliberate.

**SumatraPDF is downloaded, not bundled.** It is GPLv3; putting its binary in
our installer would make that installer a conveyed GPL work with a
corresponding-source obligation. The user's own machine fetches the official
build instead. The download is pinned to a SHA-256 in `agent/sumatra_setup.py`,
and the agent re-fetches it itself if the installer's attempt failed — so a
shop on a flaky connection still ends up working. Attribution is shown in the
agent's About tab.

**The installer is a GitHub Release asset.** A ~40 MB binary rebuilt per
version does not belong in a git repository that Vercel clones on every
deploy. `releases/latest/download/PrintQAgent-Setup.exe` is a stable address
that follows the newest release, which is what keeps the customer-facing URL
unchanged across versions.

## Releasing a new version

```
# 1. Bump the version in one place
#    agent/version.py  ->  AGENT_VERSION = "1.0.1"

# 2. Commit, tag, push
git commit -am "Agent v1.0.1"
git tag agent-v1.0.1
git push origin main --tags
```

That is the whole process. The workflow in
`.github/workflows/agent-release.yml` then:

- runs the agent test suite (and stops if it fails),
- checks the tag matches `AGENT_VERSION`, so the installer can never announce
  a version the agent does not report,
- builds `PrintQAgent.exe` with PyInstaller,
- builds `PrintQAgent-Setup.exe` with Inno Setup,
- publishes a release with that asset attached.

The website picks it up within ten minutes with no redeploy: the download page
revalidates on that interval, and `/downloads/PrintQAgent-setup.exe` is
uncached.

Pull requests touching `agent/` or `installer/` build the installer too, but
never publish — the artefact is attached to the run so a packaging change can
be tested before it is tagged.

### Building locally

Only needed when changing packaging itself.

```
cd agent
python -m pip install -r requirements.txt pyinstaller
build.bat                     # tests, icon, version resource, PrintQAgent.exe

# and, with Inno Setup 6 installed:
"%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" ..\installer\PrintQAgent.iss
```

## Where things live on the shop's machine

| What | Where | Removed on uninstall |
|---|---|---|
| Program | `%LOCALAPPDATA%\Programs\PrintQ Agent\` | yes |
| Pairing + settings | `%APPDATA%\PrintQ\agent.json` | only if asked |
| Log | `%APPDATA%\PrintQ\agent.log` | only if asked |
| Job scratch files | `%APPDATA%\PrintQ\jobs\` | only if asked |
| SumatraPDF | `%LOCALAPPDATA%\PrintQ\SumatraPDF\` | yes |

The uninstaller's prompt about pairing defaults to **No**, so upgrading never
makes a shop pair again.

## What is in the agent, and what is not

The agent holds one credential: the per-shop `agent_secret` issued at pairing,
stored in `agent.json` and sent as a header. It can reach only `/api/agent/*`,
every one of which is scoped to the shop that secret belongs to.

It contains no Supabase key, no service-role credential, and no payment
secret. `agent/test_deployment.py` asserts this over every shipped file, so a
future change that pastes one in fails the build rather than reaching a shop.
