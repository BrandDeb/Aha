#!/bin/bash

# clang-wrapper.sh - Cross-platform compiler wrapper for scriptc
# Supports Linux, macOS, and Windows (MinGW/MSVC)
# Automatically detects available compilers and translates flags

set -e

# Debug mode
DEBUG=false
if [ "$1" = "--debug" ]; then
    DEBUG=true
    set -x
    shift
fi

# Log function
log() {
    if [ "$DEBUG" = true ]; then
        echo "[clang-wrapper] $1"
    fi
}

# Detect platform
PLATFORM="unknown"
case "$(uname -s)" in
    Linux*)     PLATFORM="linux" ;;
    Darwin*)    PLATFORM="macos" ;;
    CYGWIN*|MINGW*|MSYS*) PLATFORM="windows" ;;
    *)          PLATFORM="unknown" ;;
esac

log "Detected platform: $PLATFORM"

# Detect architecture
ARCH="x64"
case "$(uname -m)" in
    x86_64)     ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)          ARCH="unknown" ;;
esac

log "Detected architecture: $ARCH"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Try to find a working C compiler
FILTERED_ARGS=()
SKIP_NEXT=false
COMPILER=""

# Preference order: clang > gcc > cc > clang++ > g++ > c++
if command_exists clang; then
    COMPILER="clang"
    log "Using compiler: clang"
elif command_exists gcc; then
    COMPILER="gcc"
    log "Using compiler: gcc"
elif command_exists cc; then
    COMPILER="cc"
    log "Using compiler: cc"
elif command_exists clang++; then
    COMPILER="clang++"
    log "Using compiler: clang++"
elif command_exists g++; then
    COMPILER="g++"
    log "Using compiler: g++"
elif command_exists c++; then
    COMPILER="c++"
    log "Using compiler: c++"
else
    echo "Error: No C compiler found. Please install clang, gcc, or cc."
    echo "  Ubuntu/Debian: sudo apt-get install clang gcc"
    echo "  macOS: brew install llvm"
    echo "  Windows: Install MinGW or Visual Studio"
    exit 1
fi

# Platform-specific setup
case "$PLATFORM" in
    windows)
        # Windows-specific flags
        FILTERED_ARGS+=("-static" "-static-libgcc" "-static-libstdc++")
        
        # Check for MinGW
        if command_exists mingw32-gcc; then
            COMPILER="mingw32-gcc"
            log "Using MinGW compiler"
        fi
        
        # Windows doesn't support some Unix-specific flags
        ;;
    macos)
        # macOS-specific flags
        # Add SDK path if available
        if [ -d "$(xcrun --show-sdk-path)" ]; then
            FILTERED_ARGS+=("-isysroot" "$(xcrun --show-sdk-path)")
            FILTERED_ARGS+=("-mmacosx-version-min=10.13")
        fi
        ;;
    linux)
        # Linux-specific setup
        : # No special flags needed
        ;;
esac

# Process arguments
for arg in "$@"; do
    if [ "$SKIP_NEXT" = true ]; then
        SKIP_NEXT=false
        continue
    fi
    
    case "$arg" in
        # Skip clang-specific flags that other compilers don't understand
        --target=*|-target|-B|-mllvm|--dependent-lib=*)
            log "Skipping clang-specific flag: $arg"
            continue
            ;;
        # Convert optimization flags (same for most compilers)
        -O0|-O1|-O2|-O3|-Os|-Ofast)
            FILTERED_ARGS+=("$arg")
            ;;
        # Skip optimization flags without values
        --optimize|--no-optimize)
            log "Skipping optimization flag: $arg"
            continue
            ;;
        # Platform-specific flags
        -isysroot)
            FILTERED_ARGS+=("$arg")
            SKIP_NEXT=true
            ;;
        -mmacosx-version-min=*)
            # Only pass macOS version flags on macOS
            if [ "$PLATFORM" = "macos" ]; then
                FILTERED_ARGS+=("$arg")
            else
                log "Skipping macOS-specific flag: $arg"
            fi
            ;;
        # Include flags
        -I*|-isystem|-include)
            FILTERED_ARGS+=("$arg")
            ;;
        # Define flags
        -D*|-U*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Library flags
        -L*|-l*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Output flags
        -o|--output=*)
            FILTERED_ARGS+=("$arg")
            SKIP_NEXT=true
            ;;
        # Standard flags
        -std=*|--std=*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Architecture flags
        -m32|-m64|-mx32)
            FILTERED_ARGS+=("$arg")
            ;;
        # Float flags
        -mfloat-abi=*|-mfpu=*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Other common flags
        -f*|-m*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Debug flags
        -g|-g0|-g1|-g2|-g3)
            FILTERED_ARGS+=("$arg")
            ;;
        # Warning flags
        -W*|-w)
            FILTERED_ARGS+=("$arg")
            ;;
        # Keep everything else as-is
        *)
            FILTERED_ARGS+=("$arg")
            ;;
    esac
done

# Add static linking for all platforms to ensure self-contained binaries
FILTERED_ARGS+=("-static")

# Add platform-specific static flags
case "$PLATFORM" in
    windows)
        FILTERED_ARGS+=("-static-libgcc" "-static-libstdc++")
        ;;
    macos)
        # macOS may have issues with static linking, try without if it fails
        ;;
    linux)
        FILTERED_ARGS+=("-static")
        ;;
esac

# Display final command if in debug mode
if [ "$DEBUG" = true ]; then
    echo "[clang-wrapper] Final command:"
    echo "$COMPILER ${FILTERED_ARGS[*]}"
fi

# Execute the compiler
log "Executing: $COMPILER ${FILTERED_ARGS[*]}"
exec $COMPILER "${FILTERED_ARGS[@]}"
