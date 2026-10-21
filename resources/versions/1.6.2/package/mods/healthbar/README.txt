healthbar - behemoth health bars for Dauntless 1.6.2 (Dauntless Forever / UE4SS)
=============================================================================

Shows a health bar for every behemoth you are fighting, in a see-through window on top of the game.
A behemoth only gets a bar after YOU damage it. Several behemoths at once get bars side by side,
each with its name above the bar and the numbers inside it, all in the same font sizes.
  A shield shows as a light blue tint with bright edges over the health bar (the red bar stays visible
  underneath, and the edges shrink as the shield ticks down). It only appears while the behemoth has a shield.

HOW IT WORKS
  The game cannot draw a bar from a Lua mod in this setup, so there are two parts:
    Scripts\main.lua         the UE4SS mod. Reads behemoth health from the game and writes it to a small
                             file (healthbar.json) in the Dauntless Forever meter folder.
    healthbar-overlay.ps1    a PowerShell script that shows a click-through window with the bars. It only
                             reads that one file and behemoth-names.txt. No network, nothing is installed.

INSTALL
  1. Copy this whole "healthbar" folder into your UE4SS Mods folder
     (...\Archon\Binaries\Win64\ue4ss\Mods\healthbar).
  2. The folder already contains an empty enabled.txt, which is what switches the mod on
     (or add "healthbar : 1" to Mods\mods.txt).
  3. Start the game in windowed or borderless ("Windowed Fullscreen") mode. A normal fullscreen game hides
     overlay windows.
  That is all: the mod starts the overlay by itself when the game starts, and the overlay closes again a few
  seconds after the game closes.

USING IT
  F8              hide / show the bars (while the game is in front). Change with -HotKey, e.g. -HotKey Ctrl+F8.
  tray icon       right-click it (bottom right) for Show/hide and Exit.
  alt-tab         the bars hide whenever Dauntless is not the active window.
  F4 (in game)    makes the mod re-check right now (mostly for troubleshooting).

NAMES
  The mod first tries to read each behemoth's real in-game name from the game's own data. When that works, the
  log line says   in-game name: <name>   and the bar shows it.
  When it does not, the bar shows the game's code name (for example "Lerawr") and the overlay adds the id to the
  bottom of behemoth-names.txt under "seen but not named yet". Type the real name after the = sign:
      lerawr_beta = Lesser Embermane
  The overlay reloads the file by itself, and a name written there always wins over the automatic one.
  (UE4SS.log also has a line   [healthbar] engaged: id=lerawr_beta ...   with the same id.)

SETTINGS
  Top of Scripts\main.lua:
      AUTO_START_OVERLAY = false   if you would rather start the overlay yourself (start-healthbar-overlay.bat).
      MAX_BARS, HIT_WINDOW, LINGER  how many bars, how strictly "my hit" is matched, how long a dead bar stays.
  Overlay options (add them to start-healthbar-overlay.bat, or edit the command in main.lua):
      -Width 600  -Gap 30  -Height 24  -NameSize 12  -NumberSize 10.5  -FromBottom 200  -HotKey F8  -NoFocusCheck  -GameProcess Dauntless*,Archon*

ABOUT AUTO-START (read this before publishing or installing)
  To start the overlay, the mod runs one command that launches PowerShell hidden with
  "-ExecutionPolicy Bypass" (that flag only applies to that one run, it changes no system setting).
  - A command window may flash for a moment when it starts. That comes from how Lua starts programs.
  - Some antivirus tools are suspicious of a game starting hidden PowerShell. If yours blocks it, set
    AUTO_START_OVERLAY = false and use start-healthbar-overlay.bat instead.
  - Starting the overlay replaces any OLDER copy of it that is still running (it stops only PowerShell
    processes whose command line names healthbar-overlay.ps1), so an updated script always takes over.
  - You can read every line of healthbar-overlay.ps1 (about 300 lines) and main.lua before using them.

TROUBLESHOOTING
  Nothing shows:   open UE4SS.log and search for "[healthbar]". You should see "local player found", then
                   "writing ...healthbar.json". If the overlay was started by hand, make sure it watches that
                   same folder (-Dir "...").
  Never shows:     right-click the tray icon: "Foreground app" shows what Windows thinks is in front while you
                   are in the game. If it is not named Dauntless... or Archon..., start the overlay with
                   -GameProcess <that name>.
  Wrong name:      put the id and the right name in behemoth-names.txt (see NAMES).
  A bar for something you did not hit:  it only appears after a health or shield drop within ~1.5 s of one of
                   your hits, so an ally hitting the same behemoth at the same moment can cause it.

NOTES
  Built for the Dauntless 1.6.2 package of Dauntless Forever. Other builds may use different class names.
  Hidden server copies of the game also load mods; this one does nothing there (it needs a local player).

LICENSE
  healthbar is free software under the GNU Affero General Public License, version 3 (AGPL-3.0-only).
  The full text is in LICENSE. You may use, change and share it, and anything you share that is based on it
  must stay under the same licence with its source available. There is no warranty.
  See NOTICE for credits and for the other projects this works with.

NOT AFFILIATED
  This is a fan-made mod. It is not made, endorsed or supported by Phoenix Labs, Epic Games, or the Dauntless
  Forever project. Use it at your own risk.
