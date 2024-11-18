import { useCallback } from "react"
import { useSWRConfig, MutatorOptions } from "swr"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { apiPath } from "./client-utils"
import { useAPI } from "./api-methods"

// TODO look into "lang" param.... and how that needs to be factored in for mutations

/**
 * Hook for creating an entity
 * @returns {(table: string, entity: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to create an entity
 */
export function useCreateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()
    const { postAPI } = useAPI()
    const { onError } = useSWRConfig()

    const createEntity = useCallback(async (table, entity, params, optimisticFields = {}) => {
        const newEntity = { id: v4(), ...entity, user_id: session?.user.id, locale: params?.lang }
        delete params?.lang

        const url = apiPath(table, null, params)

        try {
            const entity = await mutateEntity(table, newEntity.id, async () => {
                return postAPI(url, newEntity)
            }, params, {
                optimisticData: { ...newEntity, ...optimisticFields },
                revalidate: false
            })

            return { entity }
        } catch (error) {
            onError(error, url)
            return { error }
        }
    }, [session])

    return createEntity
}

/**
 * Hook for updating an entity
 * @returns {(table: string, id: string, fields: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to update an entity
 */
export function useUpdateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()
    const { patchAPI } = useAPI()
    const { onError } = useSWRConfig()

    const updateEntity = useCallback(async (table, id, fields, params) => {
        if (params?.lang) {
            fields.locale = params.lang
            delete params.lang
        }

        const url = apiPath(table, id, params)

        try {
            const entity = await mutateEntity(table, id, async () => {
                return patchAPI(url, fields)
            }, params, {
                optimisticData: (entity) => ({ updated_at: new Date(), ...entity, ...fields }),
                revalidate: false
            })

            return { entity }
        } catch (error) {
            onError(error, url)
            return { error }
        }
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
    const { deleteAPI } = useAPI()
    const { onError } = useSWRConfig()

    const deleteEntity = useCallback(async (table, id, params) => {
        delete params?.lang

        const url = apiPath(table, id, params)

        try {
            await mutateEntity(table, id, async () => {
                await deleteAPI(url)
                return null
            }, params, {
                optimisticData: null,
                revalidate: false
            })
        } catch (error) {
            onError(error, url)
            return { error }
        }

        return {}
    }, [session])

    return deleteEntity
}

/**
 * Hook for updating entities
 * @returns {(table: string, params: object, fields: object) => Promise<{error: Error?, [key: string]: any}>} The function to update entities
 */
export function useUpdateEntities() {
    const session = useSession()
    const { patchAPI } = useAPI()
    const { onError } = useSWRConfig()

    const updateEntities = useCallback(async (table, params, fields) => {
        const path = apiPath(table, null, params)

        // Patch the entities via API
        try {
            await patchAPI(session, path, fields)
        } catch (error) {
            onError(error, path)
            return { error }
        }

        return {}
    }, [session])

    return updateEntities
}

/**
 * Hook for deleting entities
 * @returns {(table: string, params: object) => Promise<{error?: Error, [key: string]: any}>} The function to delete entities
 */
export function useDeleteEntities() {
    const session = useSession()
    const { deleteAPI } = useAPI()
    const { onError } = useSWRConfig()

    const deleteEntities = useCallback(async (table, params) => {
        const path = apiPath(table, null, params)

        // Delete the entities via API
        try {
            await deleteAPI(session, path)
        } catch (error) {
            onError(error, path)
            return { error }
        }

        return {}
    }, [session])

    return deleteEntities
}

/**
 * Hook for mutating entities
 * @returns {(table: string, entities?: object[], params?: object, opts?: boolean | MutatorOptions<any, any>} The function to mutate entities
 */
export function useMutateEntities() {
    const { mutate } = useSWRConfig()
    const session = useSession()

    const mutateEntities = useCallback((table, entities, params, opts = false) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, {
            data: entities,
            count: entities?.length,
            limit: params?.limit || 100,
            offset: params?.offset || 0,
            has_more: params?.has_more || false
        }, opts)
    }, [session])

    return mutateEntities
}

/**
 * Hook for mutating an entity
 * @returns {(table: string, id: string, data?: any, params?: object, opts?: boolean | MutatorOptions<any, any>) => Promise<any>} The function to mutate an entity
 */
export function useMutateEntity() {
    const { mutate } = useSWRConfig()
    const session = useSession()

    const mutateEntity = useCallback((table, id, data, params, opts = false) => {
        const path = apiPath(table, id, params)

        if (data == undefined) return mutate(path)

        return mutate(path, data, opts)
    }, [session])

    return mutateEntity
}