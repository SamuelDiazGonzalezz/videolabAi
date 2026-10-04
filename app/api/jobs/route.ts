import { NextResponse } from 'next/server';import {VideoPipelineService} from '../../../lib/pipeline';
export async function POST(req:Request){const body=await req.json();const id=crypto.randomUUID();const result=await new VideoPipelineService().run(body);return NextResponse.json({id,...result});}


