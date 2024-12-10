import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import Peer, { DataConnection } from "peerjs"
import { v4 } from "uuid"

import { useEntities } from "./use-entity-hooks"

export interface PeersResult {
    peers: any[]
    sendData: (data: any, connections?: DataConnection[]) => void
    connections: import("peerjs").DataConnection[]
    isOnline: (userId: string) => boolean
    getPeer: (connection: import("peerjs").DataConnection) => any
    getConnectionsForUser: (userId: string) => DataConnection[]
}

interface UsePeersOptions {
    enabled?: boolean
    onData?: (data: any, connection: DataConnection, peer: any) => void | null
    room?: string | null
    allowedUsers?: string[]
}

/**
 * Peer Connections hook
 * @param {UsePeersOptions} options - The hook options
 * @param {boolean} [options.enabled=true] - Is the hook enabled
 * @param {(data: any, connection: import("peerjs").DataConnection, peer: Peer) => void} [options.onData=null] - The data handler
 * @param {string} [options.room=null] - The room to connect to
 * @param {string[]} [options.allowedUsers=["*"]] - The users allowed to send data to
 */
export function usePeers({
    enabled = true,
    onData,
    room,
    allowedUsers = ["*"]
}: UsePeersOptions): PeersResult {
    const [_, forceUpdate] = useReducer(x => x + 1, 0)

    const {
        entities: peers,
        createEntity: createPeer,
        updateEntity: updatePeer,
        deleteEntity: deletePeer,
        mutate: mutatePeers,
    } = useEntities(enabled ? 'peers' : null, { room })

    const [peer, setPeer] = useState<Peer>()
    const connectionsRef = useRef<DataConnection[]>([])
    const connectionAttempts = useRef<string[]>([])
    const [dataQueue, setDataQueue] = useState<Record<string, any>[]>([])
    const messageHistory = useRef<any[]>([])

    const getPeer = useCallback((connection: DataConnection) => {
        if (!enabled) return

        return peers?.find((peer) => peer.id == connection?.peer)
    }, [enabled, peers, connectionsRef.current])

    // Data queue handler
    useEffect(() => {
        if (!peers) return

        const newDataQueue: Record<string, any>[] = []

        dataQueue.forEach(({ data, connection }) => {
            const peer = getPeer(connection)
            if (!peer) return newDataQueue.push({ data, connection })

            if (!allowedUsers.includes("*") && !allowedUsers.includes(peer.user_id)) {
                console.error("Unauthorized data from: ", peer, connection)
                return connection.close()
            }

            onData && onData(data, connection, peer)
        })

        if (newDataQueue.length != dataQueue.length) {
            setDataQueue(newDataQueue)
        }
    }, [peers, getPeer, dataQueue, JSON.stringify(allowedUsers)])

    const handleConnection = (connection: DataConnection, inbound = false) => {
        connection?.removeAllListeners()

        // Handle incoming data and store it in the data queue
        onData && connection?.on("data", (data) => {
            setDataQueue([...dataQueue, { data, connection }])
        })

        connection?.on("open", () => {
            console.log("connection opened", room)

            // Add the connection to the list
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionsRef.current.push(connection)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()

            // Refresh the peers on new inbound connections
            inbound && mutatePeers()

            sendMessageHistory(connection)
        })

        connection?.on('close', () => {
            console.log("connection closed")

            // Remove the connection from the list
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })

        connection?.on('error', (error) => {
            console.error("connection error", error)

            // Remove the connection from the list
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })

        // 10 second timeout for connection attempts
        setTimeout(() => {
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
        }, 10000)
    }

    // Create Peer instance
    useEffect(() => {
        if (!enabled || !room) return

        // Create a new Peer instance
        const newPeer = new Peer(v4())
        newPeer.on('open', (id) => {
            console.log('Peer ID', id, 'Room', room)
            setPeer(newPeer)
        })

        // newPeer.on('error', console.error)

        return () => {
            newPeer.removeAllListeners()
            newPeer.on('open', () => newPeer.destroy())
        }
    }, [enabled, room])


    // Clean up the peer on unload
    useEffect(() => {
        if (!enabled || !room || !peer) return

        const deletePeerOnUnload = () => {
            peer?.id && deletePeer(peer.id)
            connectionsRef.current.forEach((conn) => conn.close())
            connectionsRef.current = []
            connectionAttempts.current = []
            setDataQueue([])
            messageHistory.current = []
            peer?.destroy()
        }

        window.addEventListener("beforeunload", deletePeerOnUnload)

        return () => {
            deletePeerOnUnload()
            window.removeEventListener("beforeunload", deletePeerOnUnload)
        }
    }, [enabled, room, peer])

    // Handle peer connections
    useEffect(() => {
        if (!peer?.id || !peers || !enabled || !room) return

        // Create the peer entity
        if (!peers.find((p) => p.id == peer.id)) {
            createPeer({ id: peer.id, room })
        }

        // Keep the peer entity current every 60 seconds
        const keepPeerCurrent = () => {
            const currentPeer = peers.find((p) => p.id == peer.id)
            if (currentPeer) {
                updatePeer(currentPeer.id, { updated_at: new Date() })
            } else if (peer.id) {
                createPeer({ id: peer.id, room })
            }
        }

        const interval = setInterval(keepPeerCurrent, 60000)

        // Handle inbound connections
        const inboundConnection = (connection: DataConnection) => {
            handleConnection(connection, true)
        }

        peer.on("connection", inboundConnection)

        // Connect to all peers
        peers.forEach((p) => {
            if (p.id == peer.id) return
            if (connectionsRef.current.some((connection) => connection.peer == p.id)) return
            if (connectionAttempts.current.includes(p.id)) return
            if (!allowedUsers.includes("*") && !allowedUsers.includes(p?.user_id)) return

            connectionAttempts.current.push(p.id)
            const conn = peer.connect(p.id)
            handleConnection(conn)
        })

        connectionsRef.current.forEach((conn) => {
            handleConnection(conn)
        })

        return () => {
            clearInterval(interval)
            peer.off("connection", inboundConnection)
        }
    }, [enabled, room, peers, peer, onData, connectionsRef.current, JSON.stringify(allowedUsers)])

    /**
     * Send data to connections
     * @param {any} data - The data to send
     * @param {import("peerjs").DataConnection[]} [connections] - Limit the connections to send to
     */
    const sendData = useCallback((data: any, connections?: DataConnection[]) => {
        if (!enabled) return

        // Store the data in messageHistory for 10 seconds so we can send it on connection
        messageHistory.current.push(data)

        setTimeout(() => {
            messageHistory.current = messageHistory.current.filter((d) => d != data)
        }, 10000)

        connections = connections || connectionsRef.current
        connections.forEach((connection) => {
            const peer = getPeer(connection)

            if (allowedUsers.includes("*") || allowedUsers.includes(peer?.user_id)) {
                connection.send(data)
            }
        })
    }, [enabled, getPeer, connectionsRef.current, JSON.stringify(allowedUsers)])

    const sendMessageHistory = useCallback((connection: DataConnection) => {
        if (!enabled) return

        const connectionPeer = getPeer(connection)

        if (allowedUsers.includes("*") || allowedUsers.includes(connectionPeer?.user_id)) {
            messageHistory.current.forEach(data => {
                connection.send(data)
            })
        }
    }, [enabled, JSON.stringify(allowedUsers), getPeer])


    const getConnectionsForUser = useCallback((userId: string) => {
        if (!enabled) return []

        return connectionsRef.current.filter((connection) => {
            const connectionPeer = getPeer(connection)
            return connectionPeer?.user_id == userId
        }) || []
    }, [enabled, getPeer, connectionsRef.current])

    /** 
     * Check if a user is online
     * @param {string} userId - The user ID
     * @returns {boolean} Is the user online
     */
    const isOnline = useCallback((userId: string) => !!getConnectionsForUser(userId)?.length, [getConnectionsForUser])

    return { peers, sendData, connections: connectionsRef.current, isOnline, getPeer, getConnectionsForUser }
}