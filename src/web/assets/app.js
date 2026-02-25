/**
 * tmai Remote Control Web App
 */

class TmaiRemote {
    constructor() {
        this.token = this.getToken();
        this.agents = [];
        this.teams = [];
        this.eventSource = null;
        this.selectedChoices = new Map();
        this.previousStates = new Map();
        this.expandedPreviews = new Set();
        this.previewCache = new Map();
        this.previewIntervals = new Map();
        this.pendingRender = false;
        this.reconnectDelay = 1000;

        this.attentionScrollIndex = 0;

        // Speech Recognition setup
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.speechSupported = !!SpeechRecognition;
        this.recognition = null;
        this.voiceAgentId = null;
        this.isVoiceStopping = false;

        if (this.speechSupported) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = navigator.language || 'ja-JP';
            this.setupRecognitionHandlers();
        }

        this.elements = {
            agentList: document.getElementById('agent-list'),
            connectionStatus: document.getElementById('connection-status'),
            toast: document.getElementById('toast'),
            themeBtn: document.getElementById('theme-btn'),
            agentSummary: document.getElementById('agent-summary'),
            scrollFab: document.getElementById('scroll-to-attention'),
            attentionCount: document.getElementById('attention-count'),
            voiceModal: document.getElementById('voice-modal'),
            voiceInterim: document.getElementById('voice-interim'),
            voiceResult: document.getElementById('voice-result'),
            voiceStatusText: document.getElementById('voice-status-text'),
            voiceSend: document.getElementById('voice-send'),
            voiceStop: document.getElementById('voice-stop')
        };

        if (!this.token) {
            this.showError('No authentication token provided');
            return;
        }

        this.init();
    }

    /**
     * Get token from URL query parameter
     */
    getToken() {
        const params = new URLSearchParams(window.location.search);
        return params.get('token');
    }

    /**
     * Initialize the app
     */
    async init() {
        this.loadTheme();
        this.setupHeaderButtons();
        this.setupVoiceModalButtons();
        await this.loadAgents();
        this.connectSSE();
    }

    /**
     * Fetch wrapper that automatically adds Authorization header
     * @param {string} url
     * @param {Object} options - fetch options
     * @returns {Promise<Response>}
     */
    apiFetch(url, options = {}) {
        const headers = options.headers instanceof Headers
            ? options.headers
            : new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${this.token}`);
        return fetch(url, { ...options, headers });
    }

    /**
     * Load theme from localStorage or system preference
     */
    loadTheme() {
        const saved = localStorage.getItem('tmai_theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
        }
        this.updateThemeButton();
    }

    /**
     * Toggle between dark and light theme
     */
    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('tmai_theme', newTheme);
        this.updateThemeButton();
    }

    /**
     * Update theme button icon
     */
    updateThemeButton() {
        const theme = document.documentElement.getAttribute('data-theme');
        const icon = document.getElementById('theme-icon');
        if (theme === 'light') {
            icon.innerHTML = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/>';
        } else {
            icon.innerHTML = '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>';
        }
    }

    /**
     * Setup header button event listeners
     */
    setupHeaderButtons() {
        this.elements.themeBtn.addEventListener('click', () => this.toggleTheme());
        this.elements.scrollFab.addEventListener('click', () => this.scrollToNextAttention());
    }

    /**
     * Check for state changes and show toast notifications
     * @param {Array} agents
     */
    checkForStateChanges(agents) {
        for (const agent of agents) {
            const prev = this.previousStates.get(agent.id);
            if (prev && prev !== agent.status.type) {
                if (agent.status.type === 'awaiting_approval') {
                    this.showToast(`${agent.agent_type}: Approval needed`, 'warning');
                } else if (agent.status.type === 'error') {
                    this.showToast(`${agent.agent_type}: Error`, 'error');
                }
            }
            this.previousStates.set(agent.id, agent.status.type);
        }

        this.cleanupStaleData(agents);
    }

    /**
     * Cleanup data for agents that no longer exist
     * @param {Array} agents
     */
    cleanupStaleData(agents) {
        const currentIds = new Set(agents.map(a => a.id));

        for (const id of this.previousStates.keys()) {
            if (!currentIds.has(id)) {
                this.previousStates.delete(id);
            }
        }

        for (const id of this.previewCache.keys()) {
            if (!currentIds.has(id)) {
                this.previewCache.delete(id);
            }
        }

        for (const id of this.expandedPreviews) {
            if (!currentIds.has(id)) {
                this.expandedPreviews.delete(id);
                this.stopPreviewAutoRefresh(id);
            }
        }

        for (const id of this.selectedChoices.keys()) {
            if (!currentIds.has(id)) {
                this.selectedChoices.delete(id);
            }
        }
    }

    /**
     * Load agents from API
     */
    async loadAgents() {
        try {
            const response = await this.apiFetch('/api/agents');
            if (!response.ok) {
                throw new Error('Failed to load agents');
            }
            this.agents = await response.json();
            this.render();
        } catch (error) {
            console.error('Error loading agents:', error);
            this.showError('Failed to load agents');
        }
    }

    /**
     * Connect to SSE for real-time updates
     */
    connectSSE() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource(`/api/events?token=${this.token}`);

        this.eventSource.addEventListener('agents', (event) => {
            try {
                const newAgents = JSON.parse(event.data);
                this.checkForStateChanges(newAgents);
                this.agents = newAgents;
                this.render();
                this.setConnected(true);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        });

        this.eventSource.addEventListener('teams', (event) => {
            try {
                this.teams = JSON.parse(event.data);
                this.render();
            } catch (error) {
                console.error('Error parsing teams SSE data:', error);
            }
        });

        this.eventSource.addEventListener('teammate_idle', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.showToast(`Team ${data.team_name}: ${data.member_name} is idle`, 'info');
            } catch (error) {
                console.error('Error parsing teammate_idle SSE data:', error);
            }
        });

        this.eventSource.addEventListener('task_completed', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.showToast(`Task completed: ${data.task_subject} [${data.team_name}]`, 'success');
            } catch (error) {
                console.error('Error parsing task_completed SSE data:', error);
            }
        });

        this.eventSource.onopen = () => {
            this.setConnected(true);
            this.reconnectDelay = 1000;
        };

        this.eventSource.onerror = () => {
            this.setConnected(false);
            setTimeout(() => this.connectSSE(), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        };
    }

    /**
     * Update connection status indicator
     */
    setConnected(connected) {
        const el = this.elements.connectionStatus;
        if (connected) {
            el.classList.add('connected');
            el.classList.remove('disconnected');
            el.querySelector('.status-text').textContent = 'Connected';
        } else {
            el.classList.remove('connected');
            el.classList.add('disconnected');
            el.querySelector('.status-text').textContent = 'Reconnecting...';
        }
    }

    /**
     * Check if an input field is focused
     */
    isInputFocused() {
        const active = document.activeElement;
        return active && active.classList.contains('text-input');
    }

    /**
     * Render the agent list
     */
    render() {
        if (this.isInputFocused()) {
            this.pendingRender = true;
            return;
        }

        // Save state before re-rendering
        const scrollPositions = new Map();
        const inputValues = new Map();

        this.elements.agentList.querySelectorAll('[data-agent-id]').forEach(card => {
            const agentId = card.dataset.agentId;

            const previewEl = card.querySelector('.preview-content');
            if (previewEl) {
                scrollPositions.set(agentId, previewEl.scrollTop);
            }

            const inputEl = card.querySelector('.text-input');
            if (inputEl && inputEl.value) {
                inputValues.set(agentId, inputEl.value);
            }
        });

        if (this.agents.length === 0) {
            this.elements.agentList.innerHTML = `
                <div class="empty-state">
                    <h2>No agents found</h2>
                    <p>Start an AI agent in tmux to see it here</p>
                </div>
            `;
            return;
        }

        // Sort: agents needing attention first
        const sorted = [...this.agents].sort((a, b) => {
            if (a.needs_attention && !b.needs_attention) return -1;
            if (!a.needs_attention && b.needs_attention) return 1;
            return 0;
        });

        // Group agents by team if team data is available
        let html = '';
        if (this.teams.length > 0) {
            html = this.renderWithTeamGroups(sorted);
        } else {
            html = sorted.map(agent => this.renderAgent(agent)).join('');
        }

        this.elements.agentList.innerHTML = html;
        this.attachEventListeners();

        // Restore state after re-rendering
        this.elements.agentList.querySelectorAll('[data-agent-id]').forEach(card => {
            const agentId = card.dataset.agentId;

            const scrollTop = scrollPositions.get(agentId);
            if (scrollTop !== undefined) {
                const previewEl = card.querySelector('.preview-content');
                if (previewEl) {
                    previewEl.scrollTop = scrollTop;
                }
            }

            const inputValue = inputValues.get(agentId);
            if (inputValue) {
                const inputEl = card.querySelector('.text-input');
                if (inputEl) {
                    inputEl.value = inputValue;
                }
            }
        });

        this.pendingRender = false;
        this.updateSummary();
    }

    /**
     * Update header summary and scroll FAB visibility
     */
    updateSummary() {
        const total = this.agents.length;
        const attentionCount = this.agents.filter(a => a.needs_attention).length;

        if (total === 0) {
            this.elements.agentSummary.textContent = '';
            this.elements.scrollFab.classList.add('hidden');
            return;
        }

        if (attentionCount > 0) {
            this.elements.agentSummary.innerHTML =
                `${total} agents <span class="attention-count">${attentionCount} attention</span>`;
            this.elements.scrollFab.classList.remove('hidden');
            this.elements.attentionCount.textContent = attentionCount;
        } else {
            this.elements.agentSummary.textContent = `${total} agents`;
            this.elements.scrollFab.classList.add('hidden');
        }
    }

    /**
     * Scroll to the next agent needing attention (cycles through)
     */
    scrollToNextAttention() {
        const cards = Array.from(
            this.elements.agentList.querySelectorAll('.agent-card.needs-attention')
        );
        if (cards.length === 0) return;

        // Cycle through attention cards
        if (this.attentionScrollIndex >= cards.length) {
            this.attentionScrollIndex = 0;
        }

        const target = cards[this.attentionScrollIndex];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Brief highlight effect
        target.style.transition = 'box-shadow 0.3s ease';
        target.style.boxShadow = '0 0 0 2px var(--warning)';
        setTimeout(() => {
            target.style.boxShadow = '';
        }, 1500);

        this.attentionScrollIndex++;
    }

    /**
     * Render agents grouped by team
     * @param {Array} agents - sorted agent list
     * @returns {string} HTML string
     */
    renderWithTeamGroups(agents) {
        const teamMap = new Map();
        for (const team of this.teams) {
            teamMap.set(team.name, team);
        }

        const teamAgents = new Map();
        const ungrouped = [];

        for (const agent of agents) {
            if (agent.team && agent.team.team_name) {
                const teamName = agent.team.team_name;
                if (!teamAgents.has(teamName)) {
                    teamAgents.set(teamName, []);
                }
                teamAgents.get(teamName).push(agent);
            } else {
                ungrouped.push(agent);
            }
        }

        let html = '';

        for (const [teamName, members] of teamAgents) {
            const team = teamMap.get(teamName);
            html += this.renderTeamGroup(teamName, team, members);
        }

        if (ungrouped.length > 0 && teamAgents.size > 0) {
            html += `<div class="team-group"><div class="team-header"><div class="team-header-top"><span class="team-name">Other Agents</span></div></div>`;
            html += ungrouped.map(agent => this.renderAgent(agent)).join('');
            html += '</div>';
        } else {
            html += ungrouped.map(agent => this.renderAgent(agent)).join('');
        }

        return html;
    }

    /**
     * Render a team group with header and progress bar
     * @param {string} teamName
     * @param {Object|undefined} team - team info from SSE
     * @param {Array} agents - agents in this team
     * @returns {string} HTML string
     */
    renderTeamGroup(teamName, team, agents) {
        const summary = team ? team.task_summary : { total: 0, completed: 0, in_progress: 0, pending: 0 };
        const pct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

        const progressHtml = summary.total > 0 ? `
            <div class="team-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${pct}%"></div>
                </div>
                <span class="progress-text">${summary.completed}/${summary.total} (${pct}%)</span>
            </div>
        ` : '';

        const descHtml = team && team.description
            ? `<span class="team-description">${this.escapeHtml(team.description)}</span>`
            : '';

        let html = `<div class="team-group">`;
        html += `<div class="team-header">
            <div class="team-header-top">
                <span class="team-name">${this.escapeHtml(teamName)}</span>
                ${descHtml}
            </div>
            ${progressHtml}
        </div>`;
        html += agents.map(agent => this.renderAgent(agent)).join('');
        html += '</div>';
        return html;
    }

    /**
     * Render a single agent card
     */
    renderAgent(agent) {
        const statusClass = agent.status.type;
        const needsAttention = agent.needs_attention ? 'needs-attention' : '';

        let statusLabel = agent.status.type.replace('_', ' ');
        if (agent.status.type === 'processing' && agent.status.message) {
            statusLabel = agent.status.message;
        }

        // Virtual (offline) agents - minimal card
        if (agent.is_virtual) {
            return `
                <div class="agent-card" data-agent-id="${this.escapeAttr(agent.id)}">
                    <div class="agent-header">
                        <div class="agent-header-left">
                            <span class="agent-type">${agent.agent_type}</span>
                            ${agent.team ? `<span class="team-badge">${this.escapeHtml(agent.team.member_name)}${agent.team.is_lead ? ' (lead)' : ''}</span>` : ''}
                        </div>
                        <span class="agent-status offline">offline</span>
                    </div>
                    <div class="agent-info">Pane not found</div>
                </div>
            `;
        }

        let detailsHtml = '';
        let actionsHtml = '';

        if (agent.status.type === 'awaiting_approval') {
            const details = agent.status.details || '';
            detailsHtml = details ? `<div class="agent-details">${this.escapeHtml(details)}</div>` : '';

            const phase = agent.auto_approve_phase;
            if (phase === 'judging') {
                detailsHtml += `<div class="auto-approve-badge judging">\u{1F504} AI judging...</div>`;
            } else if (phase === 'approved_rule') {
                detailsHtml += `<div class="auto-approve-badge approved">\u{2713} Rule-Approved</div>`;
            } else if (phase === 'approved_ai') {
                detailsHtml += `<div class="auto-approve-badge approved">\u{2713} AI-Approved</div>`;
            }

            if (agent.status.approval_type === 'user_question' && agent.status.choices) {
                const multiSelect = agent.status.multi_select || false;
                actionsHtml = this.renderChoices(agent.id, agent.status.choices, multiSelect);
            } else {
                actionsHtml = `
                    <div class="agent-actions">
                        <button class="btn btn-approve" data-action="approve" data-id="${this.escapeAttr(agent.id)}">
                            Approve
                        </button>
                    </div>
                `;
            }
        }

        const textInputHtml = `
            <form class="text-input-container" data-agent-id="${this.escapeAttr(agent.id)}">
                <input type="text" class="text-input"
                       enterkeyhint="send"
                       placeholder="Send message..."
                       data-agent-id="${this.escapeAttr(agent.id)}">
                ${this.speechSupported ? `<button type="button" class="btn btn-mic" data-action="voice" data-id="${this.escapeAttr(agent.id)}" aria-label="Start voice input">🎤</button>` : ''}
                <button type="submit" class="btn btn-send">Send</button>
            </form>
        `;

        const specialKeysHtml = `
            <div class="special-keys">
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Enter" title="Enter" aria-label="Send Enter key">&#x23CE;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Escape" title="Escape" aria-label="Send Escape key">Esc</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Space" title="Space" aria-label="Send Space key">&#x2423;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Tab" title="Tab" aria-label="Send Tab key">&#x21E5;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="BSpace" title="Backspace" aria-label="Send Backspace key">&#x232B;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Up" title="Up" aria-label="Send Up arrow key">&#x2191;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Down" title="Down" aria-label="Send Down arrow key">&#x2193;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Left" title="Left" aria-label="Send Left arrow key">&#x2190;</button>
                <button class="key-btn" data-action="send-key" data-id="${this.escapeAttr(agent.id)}" data-key="Right" title="Right" aria-label="Send Right arrow key">&#x2192;</button>
            </div>
        `;

        const isExpanded = this.expandedPreviews.has(agent.id);
        const previewContent = this.previewCache.get(agent.id);
        const previewHtml = `
            <div class="preview-toggle ${isExpanded ? 'expanded' : ''}" data-action="toggle-preview" data-id="${this.escapeAttr(agent.id)}">
                <svg viewBox="0 0 24 24">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
                <span>Output</span>
            </div>
            ${isExpanded ? `<div class="preview-content">${previewContent ? this.formatPreviewContent(previewContent) : '<span class="preview-loading">Loading...</span>'}</div>` : ''}
        `;

        const teamBadgeHtml = agent.team
            ? `<span class="team-badge">${this.escapeHtml(agent.team.member_name)}${agent.team.is_lead ? ' (lead)' : ''}</span>`
            : '';

        const gitBadgeHtml = agent.git_branch
            ? `<span class="git-badge ${agent.git_dirty ? 'git-dirty' : ''} ${agent.is_worktree ? 'git-worktree' : ''}">${agent.is_worktree ? 'WT: ' : ''}${this.escapeHtml(agent.git_branch)}</span>`
            : '';

        return `
            <div class="agent-card ${needsAttention}" data-agent-id="${this.escapeAttr(agent.id)}">
                <div class="agent-header">
                    <div class="agent-header-left">
                        <span class="agent-type">${agent.agent_type}</span>
                        ${teamBadgeHtml}
                        ${gitBadgeHtml}
                    </div>
                    <span class="agent-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="agent-info">
                    <span class="session">${agent.session}</span> / ${agent.window_name}
                </div>
                <div class="agent-cwd">${this.escapeHtml(agent.cwd)}</div>
                ${detailsHtml}
                ${actionsHtml}
                ${textInputHtml}
                ${specialKeysHtml}
                ${previewHtml}
            </div>
        `;
    }

    /**
     * Render choice buttons for user questions
     */
    renderChoices(agentId, choices, multiSelect) {
        const selected = this.selectedChoices.get(agentId) || new Set();

        const choiceButtons = choices.map((choice, index) => {
            const num = index + 1;
            const isSelected = selected.has(num);
            const selectedClass = isSelected ? 'selected' : '';
            return `
                <button class="choice-btn ${selectedClass}"
                        data-action="select"
                        data-id="${this.escapeAttr(agentId)}"
                        data-choice="${num}"
                        data-multi="${multiSelect}">
                    <span class="choice-number">${num}</span>
                    ${this.escapeHtml(choice)}
                </button>
            `;
        }).join('');

        const otherNum = choices.length + 1;
        const otherSelected = selected.has(otherNum);
        const otherHtml = `
            <button class="choice-btn ${otherSelected ? 'selected' : ''}"
                    data-action="select"
                    data-id="${this.escapeAttr(agentId)}"
                    data-choice="${otherNum}"
                    data-multi="${multiSelect}">
                <span class="choice-number">${otherNum}</span>
                Other
            </button>
        `;

        const submitBtn = multiSelect ? `
            <button class="btn btn-submit" data-action="submit" data-id="${this.escapeAttr(agentId)}">
                Submit Selection
            </button>
        ` : '';

        return `
            <div class="choices">
                ${choiceButtons}
                ${otherHtml}
                ${submitBtn}
            </div>
        `;
    }

    /**
     * Attach event listeners to buttons
     */
    attachEventListeners() {
        this.elements.agentList.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleAction(e));
        });

        this.elements.agentList.querySelectorAll('form.text-input-container').forEach(form => {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const agentId = form.dataset.agentId;
                if (agentId) {
                    this.handleSendText(agentId);
                }
            });
        });

        this.elements.agentList.querySelectorAll('.text-input').forEach(input => {
            input.addEventListener('blur', () => {
                if (this.pendingRender) {
                    this.render();
                }
            });
        });
    }

    /**
     * Handle button clicks
     */
    async handleAction(event) {
        const btn = event.currentTarget;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action !== 'toggle-preview') {
            btn.disabled = true;
        }

        try {
            switch (action) {
                case 'approve':
                    await this.approve(id);
                    this.showToast('Approved', 'success');
                    break;
                case 'select':
                    const choice = parseInt(btn.dataset.choice);
                    const multi = btn.dataset.multi === 'true';
                    if (multi) {
                        this.toggleChoice(id, choice);
                        this.render();
                    } else {
                        await this.select(id, choice);
                        this.showToast(`Selected option ${choice}`, 'success');
                    }
                    break;
                case 'submit':
                    await this.submit(id);
                    this.selectedChoices.delete(id);
                    this.showToast('Selection submitted', 'success');
                    break;
                case 'send-key':
                    const key = btn.dataset.key;
                    await this.sendKey(id, key);
                    this.showToast(`Sent ${key}`, 'success');
                    break;
                case 'voice':
                    this.startVoiceInput(id);
                    break;
                case 'toggle-preview':
                    await this.handleTogglePreview(id);
                    break;
            }
        } catch (error) {
            console.error('Action failed:', error);
            this.showToast('Action failed', 'error');
        } finally {
            if (action !== 'toggle-preview') {
                btn.disabled = false;
            }
        }
    }

    /**
     * Handle send text action
     * @param {string} agentId
     */
    async handleSendText(agentId) {
        const input = this.elements.agentList.querySelector(`input[data-agent-id="${agentId}"]`);
        const text = input?.value?.trim();

        if (!text) {
            this.showToast('Please enter text', 'error');
            return;
        }

        await this.sendText(agentId, text);
        input.value = '';
        this.showToast('Text sent', 'success');
    }

    /**
     * Handle toggle preview action
     * @param {string} agentId
     */
    async handleTogglePreview(agentId) {
        if (this.expandedPreviews.has(agentId)) {
            this.expandedPreviews.delete(agentId);
            this.stopPreviewAutoRefresh(agentId);
        } else {
            this.expandedPreviews.add(agentId);
            this.previewCache.delete(agentId);
            this.render();
            await this.refreshPreview(agentId, true);
            this.startPreviewAutoRefresh(agentId);
        }
        this.render();
    }

    /**
     * Refresh preview content for an agent
     * @param {string} agentId
     * @param {boolean} scrollToBottom - Whether to scroll to bottom after update
     */
    async refreshPreview(agentId, scrollToBottom = false) {
        try {
            const content = await this.getPreview(agentId);
            this.previewCache.set(agentId, content);
            if (this.expandedPreviews.has(agentId)) {
                this.updatePreviewContent(agentId, content, scrollToBottom);
            }
        } catch (error) {
            this.previewCache.set(agentId, 'Failed to load preview');
            if (this.expandedPreviews.has(agentId)) {
                this.updatePreviewContent(agentId, 'Failed to load preview', scrollToBottom);
            }
        }
    }

    /**
     * Update preview content without re-rendering (preserves scroll position)
     * @param {string} agentId
     * @param {string} content
     * @param {boolean} scrollToBottom - Whether to scroll to bottom after update
     */
    updatePreviewContent(agentId, content, scrollToBottom = false) {
        const card = this.elements.agentList.querySelector(`[data-agent-id="${agentId}"]`);
        if (!card) return;

        const previewEl = card.querySelector('.preview-content');
        if (previewEl) {
            const scrollTop = previewEl.scrollTop;
            previewEl.innerHTML = this.formatPreviewContent(content);
            if (scrollToBottom) {
                previewEl.scrollTop = previewEl.scrollHeight;
            } else {
                previewEl.scrollTop = scrollTop;
            }
        }
    }

    /**
     * Start auto-refresh for preview (every 5 seconds)
     * @param {string} agentId
     */
    startPreviewAutoRefresh(agentId) {
        this.stopPreviewAutoRefresh(agentId);

        const intervalId = setInterval(() => {
            if (this.expandedPreviews.has(agentId)) {
                this.refreshPreview(agentId);
            } else {
                this.stopPreviewAutoRefresh(agentId);
            }
        }, 5000);

        this.previewIntervals.set(agentId, intervalId);
    }

    /**
     * Stop auto-refresh for preview
     * @param {string} agentId
     */
    stopPreviewAutoRefresh(agentId) {
        const intervalId = this.previewIntervals.get(agentId);
        if (intervalId) {
            clearInterval(intervalId);
            this.previewIntervals.delete(agentId);
        }
    }

    /**
     * Toggle a choice in multi-select mode
     */
    toggleChoice(agentId, choice) {
        if (!this.selectedChoices.has(agentId)) {
            this.selectedChoices.set(agentId, new Set());
        }
        const selected = this.selectedChoices.get(agentId);
        if (selected.has(choice)) {
            selected.delete(choice);
        } else {
            selected.add(choice);
        }
    }

    /**
     * API: Approve agent
     */
    async approve(id) {
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/approve`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Approve failed');
    }

    /**
     * API: Select choice
     */
    async select(id, choice) {
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/select`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choice })
        });
        if (!response.ok) throw new Error('Select failed');
    }

    /**
     * API: Submit multi-select
     */
    async submit(id) {
        const selected = this.selectedChoices.get(id) || new Set();
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selected_choices: Array.from(selected).sort((a, b) => a - b) })
        });
        if (!response.ok) throw new Error('Submit failed');
    }

    /**
     * API: Send text to agent
     * @param {string} id
     * @param {string} text
     */
    async sendText(id, text) {
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) throw new Error('Send text failed');
    }

    /**
     * API: Send special key to agent
     * @param {string} id
     * @param {string} key
     */
    async sendKey(id, key) {
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error('Send key failed');
    }

    /**
     * API: Get preview content
     * @param {string} id
     * @returns {Promise<string>}
     */
    async getPreview(id) {
        const response = await this.apiFetch(`/api/agents/${encodeURIComponent(id)}/preview`);
        if (!response.ok) throw new Error('Get preview failed');
        const data = await response.json();
        return data.content;
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'success') {
        const toast = this.elements.toast;
        toast.textContent = message;
        toast.className = `toast ${type}`;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 2000);
    }

    /**
     * Show error in agent list
     */
    showError(message) {
        this.elements.agentList.innerHTML = `
            <div class="empty-state">
                <h2>Error</h2>
                <p>${this.escapeHtml(message)}</p>
            </div>
        `;
    }

    /**
     * Format preview content: escape HTML, then replace horizontal line chars with styled hr
     * @param {string} text - raw preview text
     * @returns {string} formatted HTML
     */
    formatPreviewContent(text) {
        const escaped = this.escapeHtml(text);
        // Replace lines consisting mostly of box-drawing horizontal chars (─━═╌╍┄┅┈┉─) or dashes
        return escaped.replace(/^[\s]*[─━═╌╍┄┅┈┉\-]{4,}[\s]*$/gm, '<hr class="preview-hr">');
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Escape string for use in HTML attributes
     * @param {string} text
     * @returns {string}
     */
    escapeAttr(text) {
        return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Setup SpeechRecognition event handlers
     */
    setupRecognitionHandlers() {
        this.recognition.onresult = (event) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            if (final) {
                const current = this.elements.voiceResult.value;
                this.elements.voiceResult.value = current ? current + final : final;
                this.elements.voiceSend.disabled = false;
            }

            this.elements.voiceInterim.textContent = interim;
        };

        this.recognition.onend = () => {
            if (!this.isVoiceStopping && this.voiceAgentId) {
                // Auto-restart when recognition stops unexpectedly (e.g., silence timeout)
                try {
                    this.recognition.start();
                } catch (_e) {
                    // Ignore if already started
                }
            }
        };

        this.recognition.onerror = (event) => {
            switch (event.error) {
                case 'not-allowed':
                    this.showToast('Microphone access denied', 'error');
                    this.cancelVoiceInput();
                    break;
                case 'no-speech':
                    // Ignore - recognition will auto-restart via onend
                    break;
                case 'network':
                    this.showToast('Network error during recognition', 'error');
                    this.cancelVoiceInput();
                    break;
                default:
                    this.showToast(`Voice error: ${event.error}`, 'error');
                    this.cancelVoiceInput();
                    break;
            }
        };
    }

    /**
     * Setup voice modal button event listeners
     */
    setupVoiceModalButtons() {
        if (!this.speechSupported) return;

        document.getElementById('voice-cancel').addEventListener('click', () => this.cancelVoiceInput());
        document.getElementById('voice-stop').addEventListener('click', () => this.stopVoiceRecording());
        document.getElementById('voice-send').addEventListener('click', () => this.sendVoiceText());

        // Close modal on Escape key
        this.elements.voiceModal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.cancelVoiceInput();
            }
        });
    }

    /**
     * Start voice input for the specified agent
     * @param {string} agentId
     */
    startVoiceInput(agentId) {
        if (!this.speechSupported) return;

        this.voiceAgentId = agentId;
        this.isVoiceStopping = false;

        // Save focused element for restoration on close
        this.prevActiveElement = document.activeElement;

        // Reset modal state
        this.elements.voiceResult.value = '';
        this.elements.voiceInterim.textContent = '';
        this.elements.voiceSend.disabled = true;
        this.elements.voiceStatusText.textContent = 'Recording...';
        this.elements.voiceStop.disabled = false;

        // Show recording dot animation
        const dot = this.elements.voiceModal.querySelector('.voice-recording-dot');
        if (dot) dot.style.display = '';

        // Show modal and move focus
        this.elements.voiceModal.hidden = false;
        this.elements.voiceStop.focus();

        // Start recognition
        try {
            this.recognition.start();
        } catch (_e) {
            // Ignore if already started
        }
    }

    /**
     * Stop voice recording (keep modal open for editing/sending)
     */
    stopVoiceRecording() {
        this.isVoiceStopping = true;
        this.recognition.stop();

        this.elements.voiceStatusText.textContent = 'Stopped';
        this.elements.voiceStop.disabled = true;

        // Hide recording dot animation
        const dot = this.elements.voiceModal.querySelector('.voice-recording-dot');
        if (dot) dot.style.display = 'none';

        // Enable send if there is text
        if (this.elements.voiceResult.value.trim()) {
            this.elements.voiceSend.disabled = false;
        }
    }

    /**
     * Send recognized text to the target agent
     */
    async sendVoiceText() {
        const text = this.elements.voiceResult.value.trim();
        if (!text || !this.voiceAgentId) return;

        try {
            await this.sendText(this.voiceAgentId, text);
            this.showToast('Voice text sent', 'success');
            this.closeVoiceModal();
        } catch (_error) {
            // Keep modal open so user can retry
            this.showToast('Failed to send voice text', 'error');
        }
    }

    /**
     * Cancel voice input and close modal
     */
    cancelVoiceInput() {
        this.closeVoiceModal();
    }

    /**
     * Close voice modal and stop recognition
     */
    closeVoiceModal() {
        this.isVoiceStopping = true;
        this.voiceAgentId = null;

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (_e) {
                // Ignore
            }
        }

        this.elements.voiceModal.hidden = true;
        this.elements.voiceResult.value = '';
        this.elements.voiceInterim.textContent = '';

        // Restore focus to the element that triggered the modal
        if (this.prevActiveElement) {
            this.prevActiveElement.focus();
            this.prevActiveElement = null;
        }
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new TmaiRemote();
});
