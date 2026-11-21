(() => {
    'use strict';

    const endpoint = '/api/summit-slide-sync';
    const isRoom = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

    async function request(method, room, body, publicView = false) {
        const headers = {};
        if (room) headers['X-Summit-Sync-Room'] = room;
        if (body) headers['Content-Type'] = 'application/json';
        const response = await fetch(publicView ? '/api/public/summit-view' : endpoint, {
            credentials: publicView ? 'omit' : 'same-origin',
            method, headers, body: body && JSON.stringify(body),
            cache: 'no-store', signal: AbortSignal.timeout(4500)
        });
        if (!response.ok) {
            const error = new Error('Slide sync request failed');
            error.status = response.status;
            throw error;
        }
        return response.status === 204 ? null : response.json();
    }

    function createClient(from, onSlide, onStatus, onEmpty, publicView = false) {
        let session = null;

        function failure(error) {
            if (error.status === 401) return 'login';
            if (error.status === 404) return 'expired';
            if (error.status === 403) return 'forbidden';
            if (error.status === 429) return 'limit';
            return 'offline';
        }

        function status(current, value) {
            if (session === current && current.status !== value) {
                current.status = value;
                onStatus(value);
            }
        }

        function apply(current, state, notify = true) {
            if (session !== current) return;
            if (state.viewer) { current.viewer = state.viewer; current.expiresAt = state.expiresAt; }
            status(current, 'online');
            if (state.revision === 0) {
                if (current.revision !== 0) {
                    current.revision = 0;
                    onEmpty?.();
                }
                return;
            }
            if (state.revision <= current.revision) return;
            current.revision = state.revision;
            if (notify) onSlide(state);
        }

        async function poll(current) {
            try {
                const state = await request('GET', current.room, undefined, publicView);
                if (!current.sending && current.pending === null) apply(current, state);
                else status(current, 'online');
                if (session === current && !current.sending && current.pending !== null) sendPending(current);
            } catch (error) {
                status(current, failure(error));
            }
            if (session === current && current.status !== 'expired') {
                const delay = current.status === 'online' ? (document.hidden ? 1500 : 450)
                    : current.status === 'login' && !current.room ? 10000 : 2500;
                current.timer = setTimeout(() => poll(current), delay);
            }
        }

        function leave() {
            clearTimeout(session?.timer);
            session = null;
        }

        function join(room, revision = 0) {
            if (room !== '' && !isRoom(room)) return;
            leave();
            const current = session = { room, revision, sending: false, pending: null };
            status(current, 'connecting');
            poll(current);
        }

        async function sendPending(current) {
            current.sending = true;
            try {
                while (session === current && current.pending !== null) {
                    const payload = current.pending;
                    current.pending = null;
                    try {
                        apply(current, await request('PUT', current.room, payload), false);
                    } catch (error) {
                        status(current, failure(error));
                        if (current.pending === null && (!error.status || error.status === 401 || error.status >= 500)) {
                            current.pending = payload;
                        }
                        break;
                    }
                }
            } finally {
                current.sending = false;
            }
        }

        return {
            get viewer() { return session?.viewer; },
            get expiresAt() { return session?.expiresAt; },
            get room() { return session?.room || ''; },
            join,
            joinDefault() { join('', -1); },
            leave,
            send(slideIndex, language) {
                if (publicView || !session || session.status === 'expired') return;
                session.pending = { from, slideIndex, language };
                if (!session.sending && session.status !== 'login') sendPending(session);
            },
            refresh() {
                if (session) join(session.room);
            },
            async start(slideIndex, language, hours = 8) {
                try {
                    const state = await request('POST', null, { from, slideIndex, language, hours });
                    join(state.room, state.revision);
                    session.viewer = state.viewer;
                    session.expiresAt = state.expiresAt;
                    return state.room;
                } catch (error) {
                    onStatus(failure(error));
                    return '';
                }
            },
            async close() {
                const current = session;
                if (!current) return true;
                try {
                    await request('DELETE', current.room);
                    if (session === current) leave();
                    return true;
                } catch (error) {
                    if (error.status === 404) {
                        if (session === current) leave();
                        return true;
                    }
                    status(current, failure(error));
                    return false;
                }
            }
        };
    }

    window.SummitSlideSync = { createClient, isRoom };
})();
