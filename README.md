# Hệ thống quản lý hội nghị TGPL Đồng Nai

Giao diện hỗ trợ đăng ký, điều phối và theo dõi hội nghị trợ giúp pháp lý.

## Chạy trên máy tính

Yêu cầu Node.js 18 trở lên. Mở terminal tại thư mục dự án và chạy:

```sh
npm start
```

Sau đó mở http://localhost:8080. Khi chưa cấu hình API, hồ sơ được lưu trong trình duyệt đang sử dụng và tệp đính kèm trong IndexedDB; dữ liệu không tự chia sẻ với người dùng khác.

## Đưa giao diện lên GitHub Pages

Có thể xuất bản các tệp HTML, CSS và JavaScript này bằng GitHub Pages. Không cần chạy `server.js` trên Pages. Mỗi người dùng sẽ có vùng lưu trữ riêng trong trình duyệt của họ.

Trang GitHub Pages không thể truy cập địa chỉ `127.0.0.1` của người dùng. Để nhiều người dùng cùng xem hồ sơ và tệp, cần triển khai một backend và cơ sở dữ liệu tại địa chỉ HTTPS công khai, xây dựng các API mà giao diện sử dụng (bao gồm danh sách đơn vị và tệp đính kèm), rồi đặt địa chỉ dạng `https://ten-mien-api/api` trong `assets/js/config.js`. Backend cần cho phép CORS từ tên miền GitHub Pages. Không đưa mật khẩu hoặc khóa bí mật vào tệp cấu hình giao diện. Repository hiện chưa có backend hoặc cơ sở dữ liệu dùng chung.
