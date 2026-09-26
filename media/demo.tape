# Demo GIF for the README. Render from the repository root after `npm run build`:
#
#   vhs media/demo.tape
#
# It needs `vhs` (https://github.com/charmbracelet/vhs) and its dependencies `ttyd` and `ffmpeg`.
# It copies media/demo (a Supabase project with one migration and three findings) to a temp
# directory, runs `check`, appends the printed grants (media/demo/grants.sql) to the migration and
# runs `check` again. test/e2e/demo.test.ts keeps the project, grants.sql and this tape in step.

Output media/demo.gif

Require node

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 720
Set Padding 24
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

Hide
Type "export REPO=$PWD DEMO=$(mktemp -d)/app && cp -R media/demo $DEMO && cd $DEMO"
Enter
# `npx supabase-grants-lint` runs this checkout's build, so the GIF matches the current code.
Type `npx() { shift; node "$REPO/dist/cli/index.js" "$@"; }`
Enter
Type "export PS1='$ ' && clear"
Enter
Show

Type "npx supabase-grants-lint check"
Sleep 300ms
Enter
Sleep 5s

Type "cat grants.sql >> supabase/migrations/20261002120000_add_todos.sql"
Sleep 300ms
Enter
Sleep 1s

Type "npx supabase-grants-lint check"
Sleep 300ms
Enter
Sleep 4s
