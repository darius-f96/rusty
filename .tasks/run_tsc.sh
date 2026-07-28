echo "Running TypeScript compiler..."
cd /Users/suciuvictortraian/Development/axiom && npx tsc --noEmit 2>&1 | grep -E "SourceControl|sourceControl|error TS" | head -60
echo "---"
echo "Exit code: $?"
