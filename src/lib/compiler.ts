/**
 * Compiler utilities for scriptc
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

interface CompileOptions {
  code: string;
  filename?: string;
  target?: 'exe' | 'c' | 'llvm' | 'wasm';
  platform?: 'linux' | 'macos' | 'windows';
  arch?: 'x64' | 'arm64';
  optimization?: 'none' | 'O1' | 'O2' | 'O3';
}

interface CompileResult {
  success: boolean;
  output?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
  files?: Record<string, string>;
  filename?: string;
  downloadUrl?: string;
}

const TEMP_DIR = path.join(process.cwd(), 'temp');

/**
 * Ensure temp directory exists
 */
async function ensureTempDir(): Promise<void> {
  try {
    await fs.access(TEMP_DIR);
  } catch {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }
}

/**
 * Generate a unique filename
 */
function generateFilename(extension: string = 'ts'): string {
  return `${randomUUID().replace(/-/g, '')}.${extension}`;
}

/**
 * Write code to a temporary file
 */
async function writeTempFile(code: string, filename: string): Promise<string> {
  await ensureTempDir();
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, code, 'utf8');
  return filePath;
}

/**
 * Compile TypeScript to native binary using scriptc
 */
export async function compileToNative(options: CompileOptions): Promise<CompileResult> {
  try {
    const filename = options.filename || generateFilename('ts');
    const filePath = await writeTempFile(options.code, filename);
    
    const platform = options.platform || process.platform === 'win32' ? 'windows' : 
                     process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = options.arch || process.arch === 'arm64' ? 'arm64' : 'x64';
    const optimization = options.optimization || 'O2';
    
    const outputFilename = filename.replace('.ts', platform === 'windows' ? '.exe' : '');
    const outputPath = path.join(TEMP_DIR, outputFilename);
    
    const scriptcArgs = [
      'build',
      filePath,
      '--target', 'binary',
      '--out', outputPath,
      '--platform', platform,
      '--arch', arch,
      '--opt', optimization,
    ];
    
    if (process.env.SCRIPTC_LINKER) {
      scriptcArgs.push('--linker', process.env.SCRIPTC_LINKER);
    }
    
    const { stdout, stderr } = await execAsync(`npx scriptc ${scriptcArgs.join(' ')}`);
    
    try {
      const compiledCode = await fs.readFile(outputPath, 'utf8');
      return {
        success: true,
        output: compiledCode,
        filename: outputFilename,
        downloadUrl: `/api/download/${outputFilename}`,
      };
    } catch {
      // File might be binary, try base64
      try {
        const binary = await fs.readFile(outputPath);
        return {
          success: true,
          output: binary.toString('base64'),
          filename: outputFilename,
          downloadUrl: `/api/download/${outputFilename}`,
        };
      } catch {
        return {
          success: true,
          output: '',
          filename: outputFilename,
          downloadUrl: `/api/download/${outputFilename}`,
          stdout,
          stderr,
        };
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}

/**
 * Compile TypeScript to C code using scriptc
 */
export async function compileToC(options: CompileOptions): Promise<CompileResult> {
  try {
    const filename = options.filename || generateFilename('ts');
    const filePath = await writeTempFile(options.code, filename);
    
    const outputFilename = filename.replace('.ts', '.c');
    const outputPath = path.join(TEMP_DIR, outputFilename);
    
    const { stdout, stderr } = await execAsync(
      `npx scriptc build ${filePath} --target c --out ${outputPath}`
    );
    
    const compiledCode = await fs.readFile(outputPath, 'utf8');
    
    return {
      success: true,
      output: compiledCode,
      filename: outputFilename,
      downloadUrl: `/api/download/${outputFilename}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}

/**
 * Compile TypeScript to LLVM IR using scriptc
 */
export async function compileToLLVM(options: CompileOptions): Promise<CompileResult> {
  try {
    const filename = options.filename || generateFilename('ts');
    const filePath = await writeTempFile(options.code, filename);
    
    const outputFilename = filename.replace('.ts', '.ll');
    const outputPath = path.join(TEMP_DIR, outputFilename);
    
    const { stdout, stderr } = await execAsync(
      `npx scriptc build ${filePath} --emit llvm --out ${outputPath}`
    );
    
    const compiledCode = await fs.readFile(outputPath, 'utf8');
    
    return {
      success: true,
      output: compiledCode,
      filename: outputFilename,
      downloadUrl: `/api/download/${outputFilename}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}

/**
 * Compile TypeScript to WASM using scriptc
 */
export async function compileToWASM(options: CompileOptions): Promise<CompileResult> {
  try {
    const filename = options.filename || generateFilename('ts');
    const filePath = await writeTempFile(options.code, filename);
    
    const llvmOutput = filename.replace('.ts', '.ll');
    const llvmPath = path.join(TEMP_DIR, llvmOutput);
    const wasmOutput = filename.replace('.ts', '.wasm');
    const wasmPath = path.join(TEMP_DIR, wasmOutput);
    
    // First, compile to LLVM IR
    await execAsync(`npx scriptc build ${filePath} --emit llvm --out ${llvmPath}`);
    
    // Try to compile LLVM IR to WASM using available tools
    let result;
    
    // Try clang with WASM target
    try {
      await execAsync(`clang --target=wasm32-wasi -O2 ${llvmPath} -o ${wasmPath}`);
      result = await fs.readFile(wasmPath);
    } catch {
      // Try llc + wasm-ld
      try {
        const wasmObj = llvmOutput.replace('.ll', '.o');
        await execAsync(`llc -O2 ${llvmPath} -o ${path.join(TEMP_DIR, wasmObj)}`);
        await execAsync(`wasm-ld ${path.join(TEMP_DIR, wasmObj)} -o ${wasmPath}`);
        result = await fs.readFile(wasmPath);
      } catch {
        // Try emcc (Emscripten)
        try {
          await execAsync(`emcc ${llvmPath} -o ${wasmPath}`);
          result = await fs.readFile(wasmPath);
        } catch {
          // Return LLVM IR as fallback
          const llvmCode = await fs.readFile(llvmPath, 'utf8');
          return {
            success: true,
            output: llvmCode,
            filename: llvmOutput,
            downloadUrl: `/api/download/${llvmOutput}`,
            error: 'WASM compilation requires LLVM WASM backend. LLVM IR provided as fallback.',
          };
        }
      }
    }
    
    return {
      success: true,
      output: result?.toString('base64'),
      filename: wasmOutput,
      downloadUrl: `/api/download/${wasmOutput}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}

/**
 * Compile TypeScript with scriptc
 */
export async function compileTypeScript(options: CompileOptions): Promise<CompileResult> {
  const target = options.target || 'exe';
  
  switch (target) {
    case 'c':
      return compileToC(options);
    case 'llvm':
      return compileToLLVM(options);
    case 'wasm':
      return compileToWASM(options);
    case 'exe':
    default:
      return compileToNative(options);
  }
}

/**
 * Clean up temporary files
 */
export async function cleanupTempFiles(filename: string): Promise<void> {
  try {
    const files = [
      path.join(TEMP_DIR, filename),
      path.join(TEMP_DIR, filename.replace('.ts', '.exe')),
      path.join(TEMP_DIR, filename.replace('.ts', '.c')),
      path.join(TEMP_DIR, filename.replace('.ts', '.ll')),
      path.join(TEMP_DIR, filename.replace('.ts', '.wasm')),
    ];
    
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch {
        // File doesn't exist, ignore
      }
    }
  } catch (error) {
    console.error('Error cleaning up temp files:', error);
  }
}

export type { CompileOptions, CompileResult };
