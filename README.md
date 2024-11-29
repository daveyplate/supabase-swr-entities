# supabase-swr-entities

WIP - Full Readme coming soon (by end of 2024)

## Installation

```bash
npm install @daveyplate/supabase-swr-entities
```

## Usage

## Entity Schema

Create schema JSON file in root directory:

`entity.schemas.json'

```json
[
    {
        "table": "profiles",
        "authenticate": false,
        "disableList": false,
        "select": ["id", "full_name", "avatar_url", "created_at", "updated_at"],
        "defaultOrder": "-created_at",
        "defaultParams": {
            "full_name_neq": null
        },
        "requiredParams": {
            "deactivated": false
        }
    }
]
```

## Pages Router Example

`/pages/api/[entities]/[entity_id].js`

```jsx
import { entityRoute } from '@daveyplate/supabase-swr-entities/server'
import { createClient } from '@/utils/supabase/api'

export default async (req, res) => {
    const supabase = createClient(req, res)

    const response = await entityRoute({
        supabase,
        ...req
    })

    res.status(response.status).json(response.body)
}
```

`/pages/api/[entities]/index.js`

```jsx
import { entitiesRoute } from '@daveyplate/supabase-swr-entities/server'
import { createClient } from '@/utils/supabase/api'

export default async (req, res) => {
    const supabase = createClient(req, res)

    const response = await entitiesRoute({
        supabase,
        ...req
    })

    res.status(response.status).json(response.body)
}
```

## App Router Example

`/app/api/[entities]/[entity_id]/route.js`

```jsx
import { entityRoute } from '@daveyplate/supabase-swr-entities/server'
import { createClient } from '@/utils/supabase/server'

async function handler(request, context) {
    const params = await context.params

    const { nextUrl: { search } } = request
    const urlSearchParams = new URLSearchParams(search)
    const query = Object.fromEntries(urlSearchParams.entries())

    const body = request.method == "POST" || request.method == "PATCH" ? await request.json() : null
    const supabase = createClient()

    const response = await entityRoute({
        supabase,
        method: request.method,
        headers: request.headers,
        query: { ...params, ...query },
        body
    })

    return Response.json(response.body, {
        status: response.status
    })
}

export async function GET(request, context) {
    return await handler(request, context)
}

export async function PATCH(request, context) {
    return await handler(request, context)
}

export async function DELETE(request, context) {
    return await handler(request, context)
}
```

`/app/api/[entities]/route.js`

```jsx
import { entitiesRoute } from '@daveyplate/supabase-swr-entities/server'
import { createClient } from '@/utils/supabase/server'

async function handler(request, context) {
    const params = await context.params

    const { nextUrl: { search } } = request
    const urlSearchParams = new URLSearchParams(search)
    const query = Object.fromEntries(urlSearchParams.entries())

    const body = request.method == "POST" || request.method == "PATCH" ? await request.json() : null
    const supabase = createClient()

    const response = await entitiesRoute({
        supabase,
        method: request.method,
        headers: request.headers,
        query: { ...params, ...query },
        body
    })

    return Response.json(response.body, {
        status: response.status
    })
}

export async function GET(request, context) {
    return await handler(request, context)
}

export async function PATCH(request, context) {
    return await handler(request, context)
}

export async function POST(request, context) {
    return await handler(request, context)
}

export async function DELETE(request, context) {
    return await handler(request, context)
}
```
