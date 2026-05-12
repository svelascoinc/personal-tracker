const Calendar = (() => {
    // ── El token lo gestiona Drive (scope combinado drive.file + calendar.events).
    // Calendar.init() ya no necesita inicializar su propio tokenClient.

    function init() {
        // No-op: el scope de Calendar está incluido en el scope de Drive.
        // El token se obtiene automáticamente cuando el usuario conecta Drive.
    }

    function connect() {
        // Delegar a Drive; el scope ya cubre calendar.events.
        Drive.connect();
    }

    async function _api(url, opts = {}) {
        const token = Drive.getToken();
        if (!token) {
            console.warn('Calendar: sin token — conectá Drive primero.');
            throw new Error('Sin token de Calendar');
        }
        const res = await fetch(url, {
            ...opts,
            headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
        });
        if (res.status === 401) { throw new Error('Token expirado — reconectá Drive'); }
        return res;
    }

    async function createEvent(task) {
        const body = {
            summary: task.title,
            description: `Sprint: ${task.sprintId}\nPrioridad: ${task.priority}\nCategoría: ${task.category}`,
            start: { date: task.due || today() },
            end:   { date: task.due || today() },
        };
        const res = await _api('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        return { id: data.id, htmlLink: data.htmlLink || null };
    }

    async function deleteEvent(eventId) {
        await _api(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
            { method: 'DELETE' }
        );
    }

    async function updateEvent(task) {
        if (!task.calendarEventId) return;
        const body = {
            summary: task.title,
            description: `Sprint: ${task.sprintId}\nPrioridad: ${task.priority}\nCategoría: ${task.category}`,
        };
        await _api(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${task.calendarEventId}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );
    }

    async function createCheckIns(task, durationHours = 3) {
        const token = Drive.getToken();
        if (!token) return [];

        const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now      = new Date();
        const deadline = task.due
            ? new Date(task.due + 'T23:59:00')
            : new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const ids       = [];
        let   checkTime = new Date(now.getTime() + 30 * 60 * 1000); // primer check en 30 min

        while (checkTime <= deadline && ids.length < 6) {
            const body = {
                summary:     `✓ Check: ${task.title}`,
                description: `¿Ya terminaste esta tarea?\nSprint: ${task.sprintId}\nPrioridad: ${task.priority}`,
                start: { dateTime: checkTime.toISOString(),                                      timeZone: tz },
                end:   { dateTime: new Date(checkTime.getTime() + 15 * 60 * 1000).toISOString(), timeZone: tz },
                reminders: {
                    useDefault: false,
                    overrides:  [{ method: 'popup', minutes: 0 }],
                },
            };
            try {
                const res  = await _api('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body),
                });
                const data = await res.json();
                if (data.id) ids.push(data.id);
            } catch (e) { console.error('Check-in creation error:', e); }

            checkTime = new Date(checkTime.getTime() + 30 * 60 * 1000);
        }

        return ids;
    }

    async function deleteCheckIns(eventIds) {
        if (!eventIds || !eventIds.length) return;
        await Promise.all(eventIds.map(id => deleteEvent(id).catch(console.error)));
    }

    return { init, connect, createEvent, deleteEvent, updateEvent, createCheckIns, deleteCheckIns };
})();
