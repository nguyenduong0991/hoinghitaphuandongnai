# Triển khai backend TGPL

Backend được đóng gói bằng Docker. Hãy tạo dịch vụ web và PostgreSQL mới, rỗng trên cùng nhà cung cấp; không dùng `DATABASE_URL` trên máy phát triển và không sao chép dữ liệu cục bộ lên môi trường công khai.

## Biến môi trường bắt buộc

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT` do nhà cung cấp cấp
- `DATABASE_URL` kết nối PostgreSQL qua TLS
- `JWT_SECRET`: chuỗi ngẫu nhiên ổn định, tối thiểu 32 ký tự
- `ALLOWED_ORIGINS=https://nguyenduong0991.github.io`
- `ADMIN_BOOTSTRAP_TOKEN`: chuỗi ngẫu nhiên dùng một lần để tạo admin đầu tiên từ website HTTPS

Backend sẽ dừng nếu thiếu database URL, secret JWT hoặc origin HTTPS. Không lưu các giá trị thật trong Git.

## Khởi tạo database và tài khoản admin

1. Chạy `npm run db:init` một lần trên database mới để áp dụng schema V1 và V2.
2. Thiết lập `ADMIN_BOOTSTRAP_TOKEN` trong secret/environment settings của nhà cung cấp.
3. Mở `https://nguyenduong0991.github.io/hoinghitaphuandongnai/login.html`, tạo tài khoản admin với mật khẩu mạnh và nhập bootstrap token.
4. Xóa `ADMIN_BOOTSTRAP_TOKEN` khỏi environment sau khi khởi tạo. Endpoint vẫn chặn tạo thêm admin khi đã có admin hoạt động.

## Lưu hồ sơ đính kèm

Ứng dụng ghi file vào `/app/uploads`. Gắn persistent volume đúng đường dẫn này hoặc cấu hình object storage trước khi dùng hồ sơ thật; filesystem mặc định của container có thể bị xóa khi dịch vụ khởi động lại hoặc deploy.

## Kết nối frontend

Sau khi có HTTPS URL backend, đặt `TGPL_API_BASE_URL` trong `assets/js/config.js` thành URL dạng `https://<host>/api`, rồi xuất bản lại GitHub Pages. Kiểm tra origin phải khớp chính xác với `ALLOWED_ORIGINS`.

Chưa có dịch vụ cloud nào được tạo bởi tài liệu này. Cần chọn nhà cung cấp/tài khoản hosting và cấu hình database/volume trước khi công khai API.

## VPS bằng Docker Compose và Caddy

Bộ `Dockerfile`, `docker-compose.yml`, `Caddyfile` và `.env.vps.example` chạy PostgreSQL nội bộ, backend nội bộ và Caddy HTTPS công khai. Chỉ Caddy mở cổng 80/443; cổng PostgreSQL và backend không publish ra Internet. Các volume PostgreSQL, tải lên và chứng chỉ TLS được lưu bền vững.

Trên VPS cần Docker Compose, domain `API_DOMAIN` trỏ A/AAAA về VPS, firewall cho phép 80/443 và SSH. Tạo `.env` từ mẫu trên VPS, đặt ba secret khác nhau, khởi động dịch vụ, chạy `docker compose exec backend npm run db:init`, rồi tạo admin lần đầu trên trang login công khai bằng bootstrap token. Sau khi admin được tạo, xóa token khỏi `.env` và khởi động lại dịch vụ. Caddy tự cấp HTTPS khi DNS và cổng công khai hợp lệ; xem [Caddy HTTPS quick-start](https://caddyserver.com/docs/quick-starts/https).

Sau đó cấu hình `TGPL_API_BASE_URL` trong frontend thành `https://<API_DOMAIN>/api` và xuất bản lại GitHub Pages. Chỉ nhập dữ liệu thử nghiệm cho tới khi đơn vị phê duyệt cách lưu trữ và sao lưu dữ liệu nghiệp vụ.
