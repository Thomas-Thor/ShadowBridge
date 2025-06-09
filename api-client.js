// ===== CARTEL API CLIENT =====

class CartelAPI {
    constructor() {
        this.baseURL = 'https://5001-i67bptdsnmqnf1l2ebh9u-8351b936.manusvm.computer/api';
        this.token = localStorage.getItem('cartel_token');
    }

    // Set authorization header
    getHeaders(includeAuth = true) {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (includeAuth && this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        return headers;
    }

    // Handle API responses
    async handleResponse(response) {
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'API request failed');
        }
        
        return data;
    }

    // Authentication methods
    async register(userData) {
        try {
            const response = await fetch(`${this.baseURL}/auth/register`, {
                method: 'POST',
                headers: this.getHeaders(false),
                body: JSON.stringify(userData)
            });
            
            const data = await this.handleResponse(response);
            
            if (data.access_token) {
                this.token = data.access_token;
                localStorage.setItem('cartel_token', this.token);
                localStorage.setItem('cartel_user', JSON.stringify(data.user));
            }
            
            return data;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(email, password) {
        try {
            const response = await fetch(`${this.baseURL}/auth/login`, {
                method: 'POST',
                headers: this.getHeaders(false),
                body: JSON.stringify({ email, password })
            });
            
            const data = await this.handleResponse(response);
            
            if (data.access_token) {
                this.token = data.access_token;
                localStorage.setItem('cartel_token', this.token);
                localStorage.setItem('cartel_user', JSON.stringify(data.user));
            }
            
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async verifyToken() {
        try {
            const response = await fetch(`${this.baseURL}/auth/verify`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Token verification error:', error);
            this.logout();
            throw error;
        }
    }

    async getProfile() {
        try {
            const response = await fetch(`${this.baseURL}/auth/profile`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Get profile error:', error);
            throw error;
        }
    }

    async updateProfile(profileData) {
        try {
            const response = await fetch(`${this.baseURL}/auth/profile`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(profileData)
            });
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Update profile error:', error);
            throw error;
        }
    }

    // Dashboard methods
    async getDashboard(role) {
        try {
            const response = await fetch(`${this.baseURL}/dashboard/${role}/dashboard`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Get dashboard error:', error);
            throw error;
        }
    }

    async getPlatformStats() {
        try {
            const response = await fetch(`${this.baseURL}/dashboard/stats`, {
                method: 'GET',
                headers: this.getHeaders()
            });
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('Get stats error:', error);
            throw error;
        }
    }

    // Utility methods
    logout() {
        this.token = null;
        localStorage.removeItem('cartel_token');
        localStorage.removeItem('cartel_user');
        window.location.href = '/';
    }

    isAuthenticated() {
        return !!this.token;
    }

    getCurrentUser() {
        const userStr = localStorage.getItem('cartel_user');
        return userStr ? JSON.parse(userStr) : null;
    }
}

// Create global API instance
window.cartelAPI = new CartelAPI();

