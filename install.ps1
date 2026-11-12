[CmdletBinding()]
param([switch]$NoLogin)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE."
    }
}

function Get-Program {
    param([string]$Name)
    $program = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $program) { throw "Install $Name and make sure it is on PATH, then run the installer again." }
    $program.Source
}

$git = Get-Program git.exe
$node = Get-Program node.exe
$npm = Get-Program npm.cmd
$codex = Get-Program codex
if ([int](& $node -p 'process.versions.node.split(".")[0]') -lt 20) {
    throw 'Install Node.js 20 or newer, then run the installer again.'
}

$repo = 'https://github.com/reallygood83/mycl-plugin-public.git'
$userHome = $env:USERPROFILE
$installDir = Join-Path $userHome '.local\share\mycl-plugin'
$skillsDir = Join-Path $userHome '.agents\skills'
$browserProfile = Join-Path $userHome '.mycl-profile'
$skills = 'mycl-router', 'mycl-login-check', 'mycl-gajeong-tongsin', 'mycl-haengbal', 'mycl-subject-comment'
$mcpArgs = @((Join-Path $installDir 'node_modules\playwright\cli.js'), 'mcp', '--browser', 'chromium', '--user-data-dir', $browserProfile)

Push-Location -LiteralPath $userHome
try {
    $servers = Invoke-Checked $codex @('mcp', 'list', '--json') | Out-String | ConvertFrom-Json
    $existing = $servers | Where-Object { $_.name -eq 'mycl-browser' }
    if ($existing -and (-not $existing.enabled -or $existing.transport.command -ne $node -or
        ($existing.transport.args -join "`n") -cne ($mcpArgs -join "`n"))) {
        throw 'Existing Codex mycl-browser configuration was preserved. Resolve the name conflict before reinstalling.'
    }

    foreach ($skill in $skills) {
        $link = Join-Path $skillsDir $skill
        $target = Join-Path $installDir "skills\$skill"
        $entry = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
        if ($entry -and ($entry.LinkType -ne 'Junction' -or [string]($entry.Target | Select-Object -First 1) -ne $target)) {
            throw "Existing skill was preserved: $link"
        }
    }

    $null = New-Item -ItemType Directory -Force -Path (Split-Path $installDir), $skillsDir
    $installed = Get-Item -LiteralPath $installDir -Force -ErrorAction SilentlyContinue
    if ($installed) {
        if (($installed.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            -not (Test-Path -LiteralPath (Join-Path $installDir '.git') -PathType Container)) {
            throw "Existing installation folder was preserved: $installDir"
        }
        $origin = Invoke-Checked $git @('-C', $installDir, 'config', '--local', '--get', 'remote.origin.url')
        $changes = Invoke-Checked $git @('-C', $installDir, 'status', '--porcelain')
        if ($origin -cne $repo -or $changes) { throw "Existing installation folder was preserved: $installDir" }
        Invoke-Checked $git @('-C', $installDir, 'fetch', 'origin', 'main')
        Invoke-Checked $git @('-C', $installDir, 'merge', '--ff-only', 'FETCH_HEAD')
        $head = Invoke-Checked $git @('-C', $installDir, 'rev-parse', 'HEAD')
        $fetched = Invoke-Checked $git @('-C', $installDir, 'rev-parse', 'FETCH_HEAD')
        if ($head -ne $fetched) { throw "Installation folder has local commits: $installDir" }
    } else {
        Invoke-Checked $git @('clone', '--branch', 'main', '--single-branch', $repo, $installDir)
    }

    Push-Location -LiteralPath $installDir
    try {
        Invoke-Checked $npm @('ci')
        Invoke-Checked $node @('node_modules/playwright/cli.js', 'install', 'chromium')
    } finally { Pop-Location }

    if (-not $existing) {
        Invoke-Checked $codex (@('mcp', 'add', 'mycl-browser', '--', $node) + $mcpArgs)
    }
    foreach ($skill in $skills) {
        $link = Join-Path $skillsDir $skill
        if (-not (Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue)) {
            $null = New-Item -ItemType Junction -Path $link -Target (Join-Path $installDir "skills\$skill")
        }
    }

    Write-Host 'Installation complete. Start a new Codex session and ask it to check your MyClass login.'
    if (-not $NoLogin) {
        Write-Host 'Sign in yourself in the Chromium window with your Teacherville account.'
        $previousProfile = $env:MYCL_PROFILE_DIR
        try {
            $env:MYCL_PROFILE_DIR = $browserProfile
            Invoke-Checked $node @((Join-Path $installDir 'scripts\login.mjs'))
        } finally { $env:MYCL_PROFILE_DIR = $previousProfile }
    }
} finally { Pop-Location }
