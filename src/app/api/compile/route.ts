import { NextRequest, NextResponse } from 'next/server';
import { compileTypeScript } from '@/lib/compiler';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, filename, target, platform } = body;
    
    if (!code) {
      return NextResponse.json(
        { error: 'Code is required' },
        { status: 400 }
      );
    }
    
    const result = await compileTypeScript({
      code,
      filename,
      target,
      platform,
      optimization: 'O2',
    });
    
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { 
        error: error.message || 'Compilation failed',
        success: false 
      },
      { status: 500 }
    );
  }
}
