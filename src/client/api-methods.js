import { isExport } from "./client-utils"

/**
 * Make a POST request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function postAPI(session, path, params) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'POST',
        headers: (isExport() && session) ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    }).then((res) => res.json()).catch((error) => { error })
}

/**
 * Make a PATCH request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function patchAPI(session, path, params) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'PATCH',
        headers: (isExport() && session) ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    }).then((res) => res.json()).catch((error) => { error })

}

/**
 * Make a DELETE request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function deleteAPI(session, path) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'DELETE',
        headers: (isExport() && session) ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' }
    }).then((res) => res.json()).catch((error) => { error })
}