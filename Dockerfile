FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Africa/Cairo
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt update -y && apt install -y software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa -y && \
    apt update -y && apt install -y \
    openssh-server \
    sudo \
    vim \
    nano \
    net-tools \
    iputils-ping \
    curl \
    wget \
    git \
    tzdata \
    ffmpeg \
    python3.11 \
    python3.11-dev \
    python3.11-venv \
    python3.11-distutils \
    build-essential \
    procps \
    htop \
    tmux \
    screen \
    unzip \
    zip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python  python  /usr/bin/python3.11 1

RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11 && \
    python3.11 -m pip install --upgrade pip setuptools wheel

RUN python3.11 -m pip install --no-cache-dir \
    mtranslate \
    google-genai \
    requests \
    g4f \
    mutagen \
    tgcalls==3.0.0.dev6 \
    py-tgcalls~=2.2.11 \
    telethon \
    aiosqlite \
    aiocron \
    emoji \
    pytz \
    gtts \
    qrcode \
    Telegram \
    aiohttp \
    fake_useragent \
    user_agent \
    hijri_converter \
    gpytranslate \
    watchdog

RUN useradd -m -s /bin/bash -G sudo song && \
    echo "song:Song@2024" | chpasswd && \
    echo "song ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#Port 22/Port 22/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    echo "AllowUsers song" >> /etc/ssh/sshd_config && \
    ssh-keygen -A

USER song
WORKDIR /home/song
RUN git clone https://github.com/JOKER684n/XVPS

USER root
WORKDIR /home/song

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
