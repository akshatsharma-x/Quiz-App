# Build optimal Nginx image
FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy the completely static vanilla JS/HTML files into the container
COPY . /usr/share/nginx/html/

# Copy the custom Nginx server block configuration to override defaults
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Boot up the server natively, daemon off so docker traps logs
CMD ["nginx", "-g", "daemon off;"]
