"""Authenticated, same-origin access to the HUGO research companion."""
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from open_webui.utils.auth import get_verified_user

router = APIRouter()


class ResearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10000)
    model: str | None = Field(default=None, max_length=256)


def service_url():
    return os.environ.get('HUGO_RESEARCH_SERVICE_URL', 'http://127.0.0.1:8787').rstrip('/')


@router.get('/health')
async def health(user=Depends(get_verified_user)):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f'{service_url()}/health')
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=503, detail='Research service unavailable')


@router.post('/research')
async def research(form: ResearchRequest, user=Depends(get_verified_user)):
    client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10))
    try:
        request = client.build_request('POST', f'{service_url()}/research', json=form.model_dump(exclude_none=True))
        response = await client.send(request, stream=True)
        response.raise_for_status()
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(status_code=502, detail='Research service unavailable')

    async def events():
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(events(), media_type='application/x-ndjson', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
