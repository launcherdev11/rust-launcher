# AppRun hook: prefer host libwayland-client over the copy bundled in the AppImage.
# Fixes WebKit EGL_BAD_ALLOC on Arch / newer Mesa (Wayland).

export DESKTOPINTEGRATION="${DESKTOPINTEGRATION:-1}"

if [ -z "${LD_PRELOAD:-}" ]; then
  for lib in \
    /usr/lib/libwayland-client.so.0 \
    /usr/lib64/libwayland-client.so.0 \
    /usr/lib/x86_64-linux-gnu/libwayland-client.so.0 \
    /usr/lib/aarch64-linux-gnu/libwayland-client.so.0 \
    /usr/lib/arm-linux-gnueabihf/libwayland-client.so.0 \
    /usr/lib/libwayland-client.so \
    /usr/lib64/libwayland-client.so \
    /usr/lib/x86_64-linux-gnu/libwayland-client.so \
    /usr/lib/aarch64-linux-gnu/libwayland-client.so \
    /usr/lib/arm-linux-gnueabihf/libwayland-client.so
  do
    if [ -f "$lib" ]; then
      export LD_PRELOAD="$lib"
      break
    fi
  done
fi
