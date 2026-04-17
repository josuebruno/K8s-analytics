FROM docker.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN rm -f /etc/apt/sources.list.d/* \
    && printf 'deb http://archive.ubuntu.com/ubuntu noble main universe multiverse restricted\n' > /etc/apt/sources.list \
    && printf 'deb http://archive.ubuntu.com/ubuntu noble-updates main universe multiverse restricted\n' >> /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Date=false -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        build-essential \
        gfortran \
        r-base \
        r-base-dev \
        libcurl4-openssl-dev \
        libssl-dev \
        libxml2-dev \
        libfontconfig1-dev \
        libfreetype6-dev \
        libpng-dev \
        libjpeg-dev \
        libtiff5-dev \
        libharfbuzz-dev \
        libfribidi-dev \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "install.packages(c('jsonlite','ggplot2'), repos='https://cloud.r-project.org')"

WORKDIR /app

COPY app/worker.R /app/worker.R
RUN chmod +x /app/worker.R

ENTRYPOINT ["Rscript", "/app/worker.R"]
