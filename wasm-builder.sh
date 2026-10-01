#!/bin/bash

# wasm-builder.sh - WASM compilation script for scriptc
# Provides multiple fallback methods for WASM compilation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Log functions
log_info() {
    echo -e "${BLUE}[WASM Builder]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[WASM Builder]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WASM Builder]${NC} $1"
}

log_error() {
    echo -e "${RED}[WASM Builder]${NC} $1"
}

# Check if file exists
check_file() {
    if [ ! -f "$1" ]; then
        log_error "File not found: $1"
        return 1
    fi
    return 0
}

# Method 1: Try clang with WASM target
build_with_clang() {
    local llvm_file="$1"
    local wasm_file="$2"
    
    log_info "Trying clang with wasm32-wasi target..."
    
    if command -v clang >/dev/null 2>&1; then
        if clang --target=wasm32-wasi -O2 "$llvm_file" -o "$wasm_file" 2>/dev/null; then
            log_success "WASM compiled with clang"
            return 0
        else
            log_warning "clang WASM compilation failed"
        fi
    else
        log_warning "clang not found"
    fi
    
    return 1
}

# Method 2: Try llc + wasm-ld
build_with_llc() {
    local llvm_file="$1"
    local wasm_file="$2"
    local obj_file="${wasm_file}.o"
    
    log_info "Trying llc + wasm-ld..."
    
    if command -v llc >/dev/null 2>&1 && command -v wasm-ld >/dev/null 2>&1; then
        if llc -O2 "$llvm_file" -o "$obj_file" 2>/dev/null && \
           wasm-ld "$obj_file" -o "$wasm_file" 2>/dev/null; then
            log_success "WASM compiled with llc + wasm-ld"
            rm -f "$obj_file"
            return 0
        else
            log_warning "llc + wasm-ld compilation failed"
        fi
    else
        log_warning "llc or wasm-ld not found"
    fi
    
    return 1
}

# Method 3: Try llvm-as + llvm-link
build_with_llvm_as() {
    local llvm_file="$1"
    local wasm_file="$2"
    local bc_file="${wasm_file}.bc"
    
    log_info "Trying llvm-as + llvm-link..."
    
    if command -v llvm-as >/dev/null 2>&1 && command -v llvm-link >/dev/null 2>&1; then
        if llvm-as "$llvm_file" -o "$bc_file" 2>/dev/null && \
           llvm-link "$bc_file" -o "$wasm_file" 2>/dev/null; then
            log_success "WASM compiled with llvm-as + llvm-link"
            rm -f "$bc_file"
            return 0
        else
            log_warning "llvm-as + llvm-link compilation failed"
        fi
    else
        log_warning "llvm-as or llvm-link not found"
    fi
    
    return 1
}

# Method 4: Try emcc (Emscripten)
build_with_emcc() {
    local llvm_file="$1"
    local wasm_file="$2"
    
    log_info "Trying emcc (Emscripten)..."
    
    if command -v emcc >/dev/null 2>&1; then
        if emcc "$llvm_file" -o "$wasm_file" -s WASM=1 -s SIDE_MODULE=1 2>/dev/null; then
            log_success "WASM compiled with emcc"
            return 0
        else
            log_warning "emcc compilation failed"
        fi
    else
        log_warning "emcc not found"
    fi
    
    return 1
}

# Method 5: Try wasienv (WASI SDK)
build_with_wasienv() {
    local llvm_file="$1"
    local wasm_file="$2"
    
    log_info "Trying wasienv (WASI SDK)..."
    
    if command -v wasienv >/dev/null 2>&1; then
        if wasienv clang "$llvm_file" -o "$wasm_file" 2>/dev/null; then
            log_success "WASM compiled with wasienv"
            return 0
        else
            log_warning "wasienv compilation failed"
        fi
    else
        log_warning "wasienv not found"
    fi
    
    return 1
}

# Main function
main() {
    if [ $# -lt 2 ]; then
        echo "Usage: $0 <llvm_file.ll> <output.wasm>"
        echo ""
        echo "Compiles LLVM IR to WASM using multiple fallback methods:"
        echo "  1. clang --target=wasm32-wasi"
        echo "  2. llc + wasm-ld"
        echo "  3. llvm-as + llvm-link"
        echo "  4. emcc (Emscripten)"
        echo "  5. wasienv (WASI SDK)"
        exit 1
    fi
    
    local llvm_file="$1"
    local wasm_file="$2"
    
    log_info "Starting WASM compilation..."
    log_info "Input: $llvm_file"
    log_info "Output: $wasm_file"
    
    # Check input file
    if ! check_file "$llvm_file"; then
        exit 1
    fi
    
    # Try each method in order
    if build_with_clang "$llvm_file" "$wasm_file"; then
        exit 0
    fi
    
    if build_with_llc "$llvm_file" "$wasm_file"; then
        exit 0
    fi
    
    if build_with_llvm_as "$llvm_file" "$wasm_file"; then
        exit 0
    fi
    
    if build_with_emcc "$llvm_file" "$wasm_file"; then
        exit 0
    fi
    
    if build_with_wasienv "$llvm_file" "$wasm_file"; then
        exit 0
    fi
    
    # All methods failed
    log_error "All WASM compilation methods failed!"
    log_error "Please install one of the following:"
    log_error "  - clang with wasm32-wasi target"
    log_error "  - llvm + wasm-ld"
    log_error "  - Emscripten (emcc)"
    log_error "  - WASI SDK (wasienv)"
    
    exit 1
}

# Run main
main "$@"
