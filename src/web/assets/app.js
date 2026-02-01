/**
 * tmai Remote Control Web App
 */

class TmaiRemote {
    constructor() {
        this.token = this.getToken();
        this.agents = [];
        this.eventSource = null;
        this.selectedChoices = new Map();

        this.elements = {
            agentList: document.getElementById('agent-list'),
            connectionStatus: document.getElementById('connection-status'),
            toast: document.getElementById('toast')
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
        await this.loadAgents();
        this.connectSSE();
    }

    /**
     * Load agents from API
     */
    async loadAgents() {
        try {
            const response = await fetch(`/api/agents?token=${this.token}`);
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
                this.agents = JSON.parse(event.data);
                this.render();
                this.setConnected(true);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        });

        this.eventSource.onopen = () => {
            this.setConnected(true);
        };

        this.eventSource.onerror = () => {
            this.setConnected(false);
            setTimeout(() => this.connectSSE(), 5000);
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
     * Render the agent list
     */
    render() {
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

        this.elements.agentList.innerHTML = sorted.map(agent => this.renderAgent(agent)).join('');
        this.attachEventListeners();
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

        let actionsHtml = '';
        let detailsHtml = '';

        if (agent.status.type === 'awaiting_approval') {
            const details = agent.status.details || '';
            detailsHtml = details ? `<div class="agent-details">${this.escapeHtml(details)}</div>` : '';

            if (agent.status.approval_type === 'user_question' && agent.status.choices) {
                const multiSelect = agent.status.multi_select || false;
                actionsHtml = this.renderChoices(agent.id, agent.status.choices, multiSelect);
            } else {
                actionsHtml = `
                    <div class="agent-actions">
                        <button class="btn btn-approve" data-action="approve" data-id="${agent.id}">
                            Approve (y)
                        </button>
                        <button class="btn btn-reject" data-action="reject" data-id="${agent.id}">
                            Reject (n)
                        </button>
                    </div>
                `;
            }
        }

        return `
            <div class="agent-card ${needsAttention}" data-agent-id="${agent.id}">
                <div class="agent-header">
                    <span class="agent-type">${agent.agent_type}</span>
                    <span class="agent-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="agent-info">
                    <span class="session">${agent.session}</span> / ${agent.window_name}
                </div>
                <div class="agent-cwd">${this.escapeHtml(agent.cwd)}</div>
                ${detailsHtml}
                ${actionsHtml}
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
                        data-id="${agentId}"
                        data-choice="${num}"
                        data-multi="${multiSelect}">
                    <span class="choice-number">${num}</span>
                    ${this.escapeHtml(choice)}
                </button>
            `;
        }).join('');

        // Add "Other" option
        const otherNum = choices.length + 1;
        const otherSelected = selected.has(otherNum);
        const otherHtml = `
            <button class="choice-btn ${otherSelected ? 'selected' : ''}"
                    data-action="select"
                    data-id="${agentId}"
                    data-choice="${otherNum}"
                    data-multi="${multiSelect}">
                <span class="choice-number">${otherNum}</span>
                Other
            </button>
        `;

        const submitBtn = multiSelect ? `
            <button class="btn btn-submit" data-action="submit" data-id="${agentId}">
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
    }

    /**
     * Handle button clicks
     */
    async handleAction(event) {
        const btn = event.currentTarget;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        btn.disabled = true;

        try {
            switch (action) {
                case 'approve':
                    await this.approve(id);
                    this.showToast('Approved', 'success');
                    break;
                case 'reject':
                    await this.reject(id);
                    this.showToast('Rejected', 'success');
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
            }
        } catch (error) {
            console.error('Action failed:', error);
            this.showToast('Action failed', 'error');
        } finally {
            btn.disabled = false;
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
        const response = await fetch(`/api/agents/${encodeURIComponent(id)}/approve?token=${this.token}`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Approve failed');
    }

    /**
     * API: Reject agent
     */
    async reject(id) {
        const response = await fetch(`/api/agents/${encodeURIComponent(id)}/reject?token=${this.token}`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Reject failed');
    }

    /**
     * API: Select choice
     */
    async select(id, choice) {
        const response = await fetch(`/api/agents/${encodeURIComponent(id)}/select?token=${this.token}`, {
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
        // First send all selected choices
        const selected = this.selectedChoices.get(id) || new Set();
        for (const choice of selected) {
            await this.select(id, choice);
            await this.delay(100);
        }

        // Then submit
        const response = await fetch(`/api/agents/${encodeURIComponent(id)}/submit?token=${this.token}`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Submit failed');
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
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
