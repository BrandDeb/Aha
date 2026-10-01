import { NextRequest, NextResponse } from 'next/server';
import { getGitHubClient } from '@/lib/github';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('github_token')?.value;
    
    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }
    
    const client = getGitHubClient(token);
    const response = await client.request('GET', '/user/repos?per_page=100', undefined);
    
    const repos = response.data.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
      html_url: repo.html_url,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      updated_at: repo.updated_at,
    }));
    
    return NextResponse.json({ repos });
  } catch (error: any) {
    console.error('Error fetching repos:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch repositories' },
      { status: 500 }
    );
  }
}
