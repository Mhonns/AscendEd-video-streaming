sudo mkdir -p /var/www/streaming
sudo rsync -a /home/ascended/AscendEd-video-streaming/frontend/ /var/www/streaming/
sudo chown -R www-data:www-data /var/www/streaming
sudo chmod -R 755 /var/www/streaming
sudo systemctl restart nginx