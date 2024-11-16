import { useCallback } from "react"
import { useSWRConfig } from "swr"
import { useSession } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { apiPath } from "./client-utils"
import { deleteAPI, patchAPI, postAPI } from "./api-methods"

// TODO look into "lang" param.... and how that needs to be factored in for mutations

/**
 * Hook for creating an entity
 * @returns {(table: string, entity: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to create an entity
 */
export function useCreateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()

    const createEntity = useCallback(async (table, entity = {}, params) => {
        let newEntity = { ...entity, user_id: session?.user.id }
        if (!newEntity.id) newEntity.id = v4()

        // Mutate the entity directly to cache
        mutateEntity(table, newEntity.id, newEntity)

        // Create the entity via API
        const path = apiPath(table, null, params)
        const { error, ...response } = await postAPI(session, path, newEntity)

        // Log and return any errors
        if (error) {
            console.error(error)
            mutateEntity(table, newEntity.id, null)

            return { error }
        }

        // Mutate the entity with the response data
        if (response.id) {
            newEntity = response
            mutateEntity(table, newEntity.id, newEntity)
        }

        // Return the result
        return { entity: newEntity }
    }, [session])

    return createEntity
}

/**
 * Hook for updating an entity
 * @returns {(table: string, id: string, entity: object, fields: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to update an entity
 */
export function useUpdateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()

    const updateEntity = useCallback(async (table, id, entity, fields, params) => {
        let newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the cache
        mutateEntity(table, id, newEntity)

        // Deal with id being "me" for example, also mutate the ID of the entity
        if (id != entity.id) {
            mutateEntity(table, entity.id, newEntity)
        }

        // Update the entity via API
        if (params) {
            params.limit = 1
        }

        const path = apiPath(table, id, params)
        const { error, ...response } = await patchAPI(session, path, fields)

        // Log and return any errors
        if (error) {
            console.error(error)
            mutateEntity(table, id, entity)

            if (id != entity.id) {
                mutateEntity(table, entity.id, entity)
            }

            return { error }
        }

        // Mutate the entity with the response data
        if (response.id) {
            newEntity = response
            mutateEntity(table, id, newEntity)

            if (id != entity.id) {
                mutateEntity(table, newEntity.id, newEntity)
            }
        }

        return { entity: newEntity }
    }, [session])

    return updateEntity
}

/**
 * Hook for deleting an entity
 * @returns {(table: string, id: string, params: object?) => Promise<{error: Error?}>} The function to delete an entity
 */
export function useDeleteEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()

    const deleteEntity = useCallback(async (table, id, params) => {
        // Mutate the entity changes directly to the cache
        mutateEntity(table, id, null)

        // Delete the entity via API
        const path = apiPath(table, id, params)
        const response = await deleteAPI(session, path)

        if (!response) return { error: new Error("Entity not found") }

        // Log and return any errors
        if (response.error) {
            console.error(response.error)
            mutateEntity(table, id)
            return { error: response.error }
        }

        return response
    }, [session])

    return deleteEntity
}

/**
 * Hook for updating entities
 * @returns {(table: string, params: object, fields: object) => Promise<{error: Error?, [key: string]: any}>} The function to update entities
 */
export function useUpdateEntities() {
    const session = useSession()

    const updateEntities = useCallback(async (table, params, fields) => {
        const path = apiPath(table, null, params)

        // Update the entities via API
        const { error, ...response } = await patchAPI(session, path, fields)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }, [session])

    return updateEntities
}

/**
 * Hook for deleting entities
 * @returns {(table: string, params: object) => Promise<{error: Error?, [key: string]: any}>} The function to delete entities
 */
export function useDeleteEntities() {
    const session = useSession()

    const deleteEntities = useCallback(async (table, params) => {
        const path = apiPath(table, null, params)

        // Delete the entity via API
        const { error, ...response } = await deleteAPI(session, path)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }, [session])

    return deleteEntities
}

/**
 * Hook for mutating entities
 * @returns {(table: string, params: object, entities: object[]} The function to mutate entities
 */
export function useMutateEntities() {
    const { mutate } = useSWRConfig()

    const mutateEntities = useCallback((table, params, entities) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, {
            data: entities,
            count: params?.count || entities?.length,
            limit: params?.limit || 100,
            offset: params?.offset || 0,
            has_more: params?.has_more || false
        }, false)
    }, [])

    return mutateEntities
}

/**
 * Hook for mutating an entity
 * @returns {(table: string, id: string, entity: object?, params: object?) => Promise<any>} The function to mutate an entity
 */
export function useMutateEntity() {
    const { mutate } = useSWRConfig()

    const mutateEntity = useCallback((table, id, entity, params) => {
        if (!id) return

        const path = apiPath(table, id, params)

        if (entity == undefined) return mutate(path)

        return mutate(path, entity, false)
    }, [])

    return mutateEntity
}