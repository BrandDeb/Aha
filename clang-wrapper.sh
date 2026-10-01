#!/bin/bash

# clang-wrapper.sh - Smart wrapper for environments without clang
# This script translates clang flags to gcc flags for compatibility
# Used by scriptc for native binary compilation

set -e

# Debug mode
if [ "$1" = "--debug" ]; then
    set -x
    shift
fi

# Check if we have clang available
if command -v clang &> /dev/null; then
    # Use clang directly with all flags
    exec clang "$@"
fi

# Check if we have gcc available
if ! command -v gcc &> /dev/null; then
    echo "Error: Neither clang nor gcc found. Please install a C compiler."
    exit 1
fi

# Filter out clang-specific flags that gcc doesn't understand
# and convert them to gcc equivalents

FILTERED_ARGS=()
SKIP_NEXT=false

for arg in "$@"; do
    if [ "$SKIP_NEXT" = true ]; then
        SKIP_NEXT=false
        continue
    fi
    
    case "$arg" in
        # Skip these flags completely (gcc doesn't support them)
        --target=*|-target|-B|-mllvm|--dependent-lib=*)
            continue
            ;;
        # Convert -O* flags (they're the same)
        -O0|-O1|-O2|-O3|-Os|-Ofast)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert optimization flags
        --optimize|--no-optimize)
            # These are handled by -O flags
            continue
            ;;
        # Convert platform-specific flags
        -isysroot)
            FILTERED_ARGS+=("$arg")
            SKIP_NEXT=true
            ;;
        -mmacosx-version-min=*)
            # Remove macOS version flags for gcc
            continue
            ;;
        # Convert warning flags (mostly the same)
        -W*|-w)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert debug flags
        -g|-g0|-g1|-g2|-g3)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert include flags
        -I*|-isystem|-include)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert define flags
        -D*|-U*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert library flags
        -L*|-l*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert output flags
        -o|--output=*)
            FILTERED_ARGS+=("$arg")
            SKIP_NEXT=true
            ;;
        # Convert standard flags
        -std=*|--std=*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert architecture flags
        -m32|-m64|-mx32)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert float flags
        -mfloat-abi=*|-mfpu=*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Convert other common flags
        -f*|-m*)
            FILTERED_ARGS+=("$arg")
            ;;
        # Keep everything else as-is
        *)
            FILTERED_ARGS+=("$arg")
            ;;
    esac
done

# Add -static flag for gcc to produce static binaries (like clang would)
# This ensures the output is self-contained
FILTERED_ARGS+=("-static")

# Execute gcc with filtered arguments
exec gcc "${FILTERED_ARGS[@]}"
