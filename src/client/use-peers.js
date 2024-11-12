import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import Peer, { DataConnection } from "peerjs"
import { useEntities } from "@daveyplate/supabase-swr-entities/client"

/**
 * Peer Connections hook
 * @param {Object} props - The hook props
 * @param {boolean} [props.enabled=true] - Is the hook enabled
 * @param {(data: any, connection: DataConnection, peer: Peer) => void} [props.onData=null] - The data handler
 * @param {string} [props.room=null] - The room to connect to
 * @param {string} [props.peerLimiter=null] - The column to filter which peer ID to send to
 * @param {string[]} [props.allowedUsers=["*"]] - The users allowed to send data to
 * @returns {{ peers: any[], sendData: (data: any) => void, connections: DataConnection[], isOnline: (userId: string) => boolean, getPeer: (connection: DataConnection) => any, getConnection: (userId: string) => DataConnection}} The hook result
 */
export function usePeers({ enabled = true, onData = null, room = null, peerLimiter = null, allowedUsers = ["*"] }) {
    const [_, forceUpdate] = useReducer(x => x + 1, 0)

    const {
        entities: peers,
        createEntity: createPeer,
        updateEntity: updatePeer,
        deleteEntity: deletePeer,
        mutateEntities: mutatePeers,
    } = useEntities(enabled && 'peers', { room })

    const [peer, setPeer] = useState(null)
    const connectionsRef = useRef([])
    const connectionAttempts = useRef([])
    const dataQueue = useRef([])

    // Data queue for when we need reload for missing peers
    useEffect(() => {
        if (!peers) return

        const newDataQueue = []
        dataQueue.current.forEach(({ data, connection }) => {
            const peer = getPeer(connection)
            if (!peer) {
                newDataQueue.push({ data, connection })
                return
            }

            onData(data, connection, peer)
        })

        dataQueue.current = newDataQueue
    }, [peers])

    /**
     * Prepare connection handlers
     * @param {DataConnection} connection - The connection
     * @param {boolean} [inbound=false] - Is the connection inbound
     */
    const handleConnection = (connection, inbound = false) => {
        connection?.removeAllListeners()

        onData && connection?.on("data", (data) => {
            const peer = getPeer(connection)
            if (!peer) {
                dataQueue.current.push({ data, connection })
                return
            }

            if (allowedUsers.includes("*") || allowedUsers.includes(peer?.user_id)) {
                onData(data, connection, peer)
            } else {
                console.log("Unauthorized data from", peer)
                connection.close()
            }
        })

        connection?.on("open", () => {
            console.log("connection opened")
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionsRef.current.push(connection)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()

            if (inbound) {
                mutatePeers()
            }
        })

        connection?.on('close', () => {
            console.log("connection closed")
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })

        connection?.on('error', (error) => {
            console.error("connection error", error)
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })
    }

    // Clean up the peer on unmount
    useEffect(() => {
        if (!enabled) return

        const deletePeerOnUnload = () => {
            connectionsRef.current.forEach((conn) => conn.close())
            connectionsRef.current = []
            connectionAttempts.current = []
            peer?.id && deletePeer(peer.id)
            peer?.destroy()
        }

        window.addEventListener("beforeunload", deletePeerOnUnload)

        return () => {
            deletePeerOnUnload()
            window.removeEventListener("beforeunload", deletePeerOnUnload)
        }
    }, [peer, room, enabled])

    useEffect(() => {
        if (!enabled) return

        setTimeout(() => {
            connectionAttempts.current = []
        }, 10000)
    }, [peers])

    useEffect(() => {
        if (!peer?.id || !peers || !enabled) return

        const keepPeerCurrent = () => {
            const currentPeer = peers.find((p) => p.id == peer.id)
            if (currentPeer) {
                updatePeer(currentPeer, { updated_at: new Date() })
            } else {
                createPeer({ id: peer.id, room })
            }
        }

        const interval = setInterval(keepPeerCurrent, 60000)

        if (!peers.find(p => p.id == peer.id)) {
            console.log("Create a Peer Entity")
            createPeer({ id: peer.id, room })
        }

        const inboundConnection = (conn) => {
            handleConnection(conn, true)
        }

        peer.on("connection", inboundConnection)

        peers.forEach(p => {
            if (p.id == peer.id) return
            if (connectionsRef.current.some((c) => c.peer == p.id)) return
            if (connectionAttempts.current.includes(p.id)) return
            if (allowedUsers.includes("*") || allowedUsers.includes(p?.user_id)) {
                console.log("connection attempt", p.id)
                connectionAttempts.current.push(p.id)
                const conn = peer.connect(p.id)
                handleConnection(conn)
            }
        })

        connectionsRef.current.forEach((conn) => {
            handleConnection(conn)
        })

        return () => {
            clearInterval(interval)
            peer.off("connection", inboundConnection)
        }
    }, [peers, peer, onData, connectionsRef.current])


    useEffect(() => {
        if (!enabled) return

        // Create a new Peer instance
        const newPeer = new Peer()
        newPeer.on('open', (id) => {
            console.log('Peer ID: ' + id)
            setPeer(newPeer)
        })

        // newPeer.on('error', console.error)

        return () => {
            newPeer.destroy()
        }
    }, [enabled, room])

    /**
     * Send data to all connections
     * @param {any} data - The data to send
     */
    const sendData = useCallback((data) => {
        connectionsRef.current.forEach((connection) => {
            const peer = getPeer(connection)

            if (peerLimiter) {
                const recipientId = data.data[peerLimiter]
                if (!recipientId) return

                if (peer?.user_id != recipientId) return
            }

            if (allowedUsers.includes("*") || allowedUsers.includes(peer?.user_id)) {
                connection.send(data)
            }

        })
    }, [peers, peerLimiter, connectionsRef.current])

    /**
     * Get the peer for a connection
     * @param {DataConnection} connection - The connection
     * @returns {any} The peer
     */
    const getPeer = useCallback((connection) => {
        return peers?.find((peer) => peer.id == connection?.peer)
    }, [peers, connectionsRef.current])

    /**
     * Get the connection for a user
     * @param {string} userId - The user ID
     * @returns {DataConnection} The connection
     */
    const getConnection = useCallback((userId) => {
        const connection = connectionsRef.current.find((connection) => {
            const connectionPeer = getPeer(connection)
            return connectionPeer?.user_id == userId
        })

        return connection
    }, [peers, connectionsRef.current])

    /** 
     * Check if a user is online
     * @param {string} userId - The user ID
     * @returns {boolean} Is the user online
     */
    const isOnline = useCallback((userId) => {
        return !!getConnection(userId)
    }, [getConnection])

    return { peers, sendData, connections: connectionsRef.current, isOnline, getPeer, getConnection }
}