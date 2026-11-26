FROM nginx:1.27-alpine

# Static site (HTML/CSS/JS – no build step)
RUN rm -rf /usr/share/nginx/html/*
COPY . /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/.dockerignore

# Server block: static files + reverse proxy to the API / Socket.io
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
