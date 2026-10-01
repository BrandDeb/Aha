import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'temp');

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string[] } }
) {
  try {
    const filename = params.filename.join('/');
    const filePath = path.join(TEMP_DIR, filename);
    
    try {
      const fileBuffer = await fs.readFile(filePath);
      
      const response = new NextResponse(fileBuffer);
      response.headers.set('Content-Disposition', `attachment; filename="${filename}"`);
      response.headers.set('Content-Type', 'application/octet-stream');
      
      return response;
    } catch (error) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to download file' },
      { status: 500 }
    );
  }
}
