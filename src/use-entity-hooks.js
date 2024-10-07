import { useEffect, useState } from "react"
import { useSession } from "@supabase/auth-helpers-react"
import useSWR, { useSWRConfig } from "swr"
import { v4 } from "uuid"

/**
 * Wraps useSWR with enabled state 
 * @param {string} query - The query to fetch
 * @param {object} config - The options for the fetch
 * @returns {import("swr").SWRResponse} - The SWR response
 */
function useCache(query, config) {
    const { provider } = useSWRConfig()
    const swr = useSWR(provider ? query : null, config)

    return { ...swr, isLoading: swr.isLoading || !provider }
}

export const useEntity = (table, id, params = null, swrConfig = null) => {
    const path = apiPath(table, id, params)
    const swrResponse = useCache(path, swrConfig)
    const { data } = swrResponse

    let entity

    if (id) {
        entity = data
    } else {
        entity = data?.data?.[0]
    }

    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const { mutate } = useSWRConfig()

    const mutateEntity = (entity, opts) => {
        if (entity == undefined) {
            mutate(path)
        }

        mutate(path, entity, opts)
    }

    const update = async (entity, fields) => {
        return await updateEntity(table, entity, fields, params)
    }

    const doDelete = async () => {
        return await deleteEntity(table, id, params)
    }

    return { ...swrResponse, entity, updateEntity: update, deleteEntity: doDelete, mutate: mutateEntity }
}

export const useEntities = (table, params = null, swrConfig = null) => {
    const path = apiPath(table, null, params)
    const swrResponse = useCache(path, swrConfig)
    const { data } = swrResponse
    const { data: entities, count, limit, offset, has_more } = data || {}
    const { mutate } = useSWRConfig()
    const [addEntity, setAddEntity] = useState(null)
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const session = useSession()

    const mutateEntities = (entities, opts) => {
        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, { data: entities, count, limit, offset, has_more }, opts)
    }

    useEffect(() => {
        // Mutate the individual entities directly to the cache
        entities?.forEach(entity => {
            const path = apiPath(table, entity.id)
            mutate(path, entity, false)
        })
    }, [entities])

    // Fix for delayed updates
    useEffect(() => {
        if (!addEntity) return
        setAddEntity(null)
        mutateEntities([...entities?.filter(e => e.id != addEntity.id), addEntity], false)
    }, [addEntity])

    const create = async (entity) => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        mutateEntities([...entities, newEntity], false)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) mutateEntities()
        if (response.data?.id) setAddEntity(response.data)

        return response
    }

    const update = async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntities(entities.map(e => e.id == entity.id ? newEntity : e), false)

        // Update the entity via API
        const response = await updateEntity(table, entity, fields)
        if (response.error) mutateEntities()

        return response
    }

    const doDelete = async (id) => {
        // Mutate the entity deletion directly to the parent cache
        mutateEntities(entities.filter(e => e.id != id), false)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) mutateEntities()

        return response
    }

    return {
        ...swrResponse,
        entities,
        count,
        limit,
        offset,
        has_more,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutate: mutateEntities
    }
}

export const useCreateEntity = () => {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const createEntity = async (table, entity = {}, params) => {
        let newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        // Mutate the entity directly to cache
        const mutatePath = apiPath(table, newEntity.id, params)
        mutate(mutatePath, newEntity, false)

        // Create the entity via API
        const path = apiPath(table, null, params)
        const response = await postAPI(session, path, newEntity)
        const { data, error } = response

        // Log and toast any errors
        if (error) {
            console.error(error)
            toast("Error creating object", { color: "danger" })
        }

        // Mutate the entity with the response data
        if (data?.id) {
            newEntity = response.data
            const mutatePath = apiPath(table, newEntity.id, params)

            mutate(mutatePath, entity, false)
        }

        // Return the result
        return { ...response, entity: newEntity }
    }

    return createEntity
}

export const useUpdateEntity = () => {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const updateEntity = async (table, entity, fields, params) => {
        // Only allow users to update "me" entity
        if (table == "users") {
            entity.id = "me"
        }

        let path = apiPath(table, entity.id, params)
        let newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the cache
        mutate(path, newEntity, false)

        // Update the entity via API
        const response = await patchAPI(session, path, fields)
        const { data, error } = response

        // Log and toast any errors
        if (error) {
            console.error(error)
            toast("Error updating", { color: "danger" })
            mutate(path)
        }

        // Mutate the entity with the response data
        if (data?.id) {
            newEntity = response.data
            mutate(path, newEntity, false)
        }

        return { ...response, entity: newEntity }
    }

    return updateEntity
}

export const useDeleteEntity = () => {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const deleteEntity = async (table, id, params) => {
        const path = apiPath(table, id, params)

        // Mutate the entity changes directly to the cache
        mutate(path, null, false)

        // Delete the entity via API
        const response = await deleteAPI(session, path)
        const { error } = response

        // Log and toast any errors
        if (error) {
            console.error(error)
            toast("Error deleting object", { color: "danger" })
        }

        return response
    }

    return deleteEntity
}

export const useUpdateEntities = () => {
    const session = useSession()

    const updateEntities = async (table, params, fields) => {
        const path = apiPath(table, null, params)

        // Update the entities via API
        const response = await patchAPI(session, path, fields)
        const { error } = response

        // Log and toast any errors
        if (error) {
            console.error(error)
            toast("Error updating objects", { color: "danger" })
        }

        return response
    }

    return updateEntities
}

export const useDeleteEntities = () => {
    const session = useSession()

    const deleteEntities = async (table, params) => {
        const path = apiPath(table, null, params)

        // Delete the entity via API
        const response = await deleteAPI(session, path)
        const { error } = response

        // Log and toast any errors
        if (error) {
            console.error(error)
            toast("Error deleting object", { color: "danger" })
        }

        return response
    }

    return deleteEntities
}

export const useMutateEntities = () => {
    const { mutate } = useSWRConfig()

    const mutateEntities = (table, params, entities, opts) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, { data: entities, count: entities.length, limit: 100, offset: 0, has_more: false }, opts)
    }

    return mutateEntities
}

export const useMutateEntity = () => {
    const { mutate } = useSWRConfig()

    const mutateEntity = (table, id, entity) => {
        const path = apiPath(table, id)

        if (entity == undefined) {
            return mutate(path)
        }

        return mutate(path, entity, false)
    }

    return mutateEntity
}

const apiPath = (table, id, params) => {
    if (!table) return null

    const route = table.replaceAll('_', '-')
    let path = `/api/${route}`

    if (id) {
        path += `/${id}`
    }

    if (params) {
        const query = new URLSearchParams(params)
        path += `?${query.toString()}`
    }

    return path
}

/**
 * Make a POST request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise} A promise that resolves with the API response.
 */
export const postAPI = async (session, path, params) => {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return await fetch(url, {
        method: 'POST',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    })
}

/**
 * Make a PATCH request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise} A promise that resolves with the API response.
 */
export const patchAPI = async (session, path, params) => {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return await fetch(url, {
        method: 'PATCH',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    })
}

/**
 * Make a DELETE request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @returns {Promise} A promise that resolves with the API response.
 */
export const deleteAPI = async (session, path) => {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return await fetch(url, {
        method: 'DELETE',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' }
    })
}

/**
 * Check if the app is being exported.
 * @returns {boolean} True if NEXT_PUBLIC_IS_EXPORT is "1", false otherwise.
 */
function isExport() {
    return process.env.NEXT_PUBLIC_IS_EXPORT == "1"
}