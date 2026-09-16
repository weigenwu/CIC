$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    if ((git branch --show-current) -ne 'main') { throw 'Switch to main before publishing.' }
    if (git status --porcelain) { throw 'Commit reviewed changes before publishing.' }
    if ((git remote get-url origin) -ne 'https://github.com/weigenwu/CIC.git') { throw 'Unexpected repository remote.' }
    npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Syntax checks failed.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Data or coordinate checks failed.' }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Source push failed.' }
    $splitCommit = git subtree split --prefix dist
    if ($LASTEXITCODE -ne 0 -or $splitCommit -notmatch '^[a-f0-9]{40}$') { throw 'Static export failed.' }
    git push origin "${splitCommit}:refs/heads/codex/pages"
    if ($LASTEXITCODE -ne 0) { throw 'Static branch push failed.' }
    gh api --method POST repos/weigenwu/CIC/pages/builds
    if ($LASTEXITCODE -ne 0) { throw 'Could not request Pages publication.' }
    Write-Host 'Publication requested. Check https://weigenwu.github.io/CIC/ after Pages finishes.'
} finally { Pop-Location }
