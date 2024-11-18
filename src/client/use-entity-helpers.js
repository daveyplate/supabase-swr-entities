import { useCallback } from "react"
import { useSWRConfig, MutatorOptions } from "swr"
import { useSession } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { apiPath } from "./client-utils"
import { deleteAPI, patchAPI, postAPI, useAPI } from "./api-methods"

// TODO look into "lang" param.... and how that needs to be factored in for mutations

/**
 * Hook for creating an entity
 * @returns {(table: string, entity: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to create an entity
 */
export function useCreateEntity() {
    const session = useSession()
    const { postAPI } = useAPI()
    const mutateEntity = useMutateEntity()

    const createEntity = useCallback(async (table, entity, params, optimisticFields = {}) => {
        const newEntity = { id: v4(), ...entity, user_id: session?.user.id, locale: params?.lang }
        delete params?.lang

        return mutateEntity(table, newEntity.id, async () => {
            const url = apiPath(table, null, params)
            const response = await postAPI(url, newEntity)
            if (response.error) throw response.error
            return response
        }, params, {
            optimisticData: { ...newEntity, ...optimisticFields },
            revalidate: false
        })
    }, [session])

    return createEntity
}

/**
 * Hook for updating an entity
 * @returns {(table: string, id: string, fields: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to update an entity
 */
export function useUpdateEntity() {
    const session = useSession()
    const { patchAPI } = useAPI()
    const mutateEntity = useMutateEntity()

    const updateEntity = useCallback(async (table, id, fields, params) => {
        if (params?.lang) {
            fields.locale = params.lang
            delete params.lang
        }

        return mutateEntity(table, id, async () => {
            const url = apiPath(table, id, params)
            const response = await patchAPI(url, fields)
            if (response.error) throw response.error
            return response
        }, params, {
            optimisticData: (entity) => ({ updated_at: new Date(), ...entity, ...fields }),
            revalidate: false
        })
    }, [session])

    return updateEntity
}

/**
 * Hook for deleting an entity
 * @returns {(table: string, id: string, params: object?) => Promise<{error: Error?}>} The function to delete an entity
 */
export function useDeleteEntity() {
    const session = useSession()
    const { deleteAPI } = useAPI()
    const mutateEntity = useMutateEntity()

    const deleteEntity = useCallback(async (table, id, params) => {
        delete params?.lang

        return mutateEntity(table, id, async () => {
            const url = apiPath(table, id, params)
            const response = await deleteAPI(url)
            if (response.error) throw response.error
            return null
        }, params, {
            optimisticData: null,
            revalidate: false
        })
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
 * @returns {(table: string, params: object) => Promise<{error?: Error, [key: string]: any}>} The function to delete entities
 */
export function useDeleteEntities() {
    const session = useSession()
    const { deleteAPI } = useAPI()

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
 * @returns {(table: string, entities?: object[], params?: object, opts?: boolean | MutatorOptions<any, any>} The function to mutate entities
 */
export function useMutateEntities() {
    const { mutate } = useSWRConfig()
    const session = useSession()

    const mutateEntities = useCallback((table, entities, params, opts = false) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate([path, session?.access_token])
        }

        return mutate([path, session?.access_token], {
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

        if (data == undefined) return mutate([path, session?.access_token])

        return mutate([path, session?.access_token], data, opts)
    }, [session])

    return mutateEntity
}