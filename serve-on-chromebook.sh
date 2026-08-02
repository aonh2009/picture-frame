#!/bin/bash
# Serves the Picture Frame app locally on the Chromebook (Linux mode).
# Run from the folder that contains this script:  bash serve-on-chromebook.sh
# Then open  http://localhost:8321  in Chrome. localhost counts as a secure
# origin, so the app gets the full folder API: the chosen folder is
# remembered and newly added pictures are detected automatically.
cd "$(dirname "$0")"
echo "Picture Frame server running — open http://localhost:8321 in Chrome."
echo "(Keep this terminal open, or add this script to Linux autostart.)"
python3 -m http.server 8321
