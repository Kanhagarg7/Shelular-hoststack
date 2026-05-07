#!/bin/sh
if [ -n "$MACHINE_ID_RAW" ]; then
  printf '%s\n' "$MACHINE_ID_RAW" > /etc/machine-id
  printf '%s\n' "$MACHINE_ID_RAW" > /var/lib/dbus/machine-id 2>/dev/null || true
fi

# Execute the command as the current user (root)
exec "$@"
