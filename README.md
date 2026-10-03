# Hệ thống quản lý hội nghị TGPL Đồng Nai

Repository này chứa giao diện web. Backend Node.js/Express, PostgreSQL và tệp tải lên nằm riêng tại `D:\DuAnTGPL\backend`; tất cả xã/phường dùng chung các bảng dữ liệu, không phân vùng hồ sơ theo đơn vị.

## Khởi chạy lần đầu

1. Trong `D:\DuAnTGPL\backend`, cài dependencies nếu cần, chạy migration V2 một lần bằng `npm run db:migrate:v2`, sau đó khởi động backend bằng `npm start`.
2. Trong repository giao diện này, chạy `npm start` để phục vụ giao diện tại `http://localhost:8080`.
3. Mở `http://localhost:8080/login.html`. Lần đầu, tạo mật khẩu admin tối thiểu 12 ký tự. Sau đó vào **Quản lý tài khoản** để tạo tài khoản xã/phường.

Backend mặc định chỉ lắng nghe trên máy cục bộ ở cổng 3000. Khởi tạo admin lần đầu cũng chỉ được phép từ máy cục bộ. `JWT_SECRET` được tạo và lưu trong `.env` của backend; không đưa `.env` lên Git.

## Quyền truy cập

- Tài khoản xã/phường có thể gửi yêu cầu và xem dữ liệu hội nghị dùng chung.
- Chỉ admin có thể duyệt, từ chối, hủy yêu cầu (có lưu lý do/lịch sử), xóa hồ sơ và quản trị tài khoản.
- Dữ liệu theo xã/phường vẫn cùng nằm trong một bộ dữ liệu chung.

## Chạy thử công khai trên GitHub Pages

Mỗi lần đẩy thay đổi lên nhánh `main`, GitHub Actions sẽ xuất bản giao diện tại GitHub Pages. Nếu đây là lần đầu, vào **Settings → Pages**, chọn **GitHub Actions** làm nguồn xuất bản; sau đó xem URL trong **Actions → Deploy static site to GitHub Pages**.

GitHub Pages chỉ phục vụ giao diện tĩnh, không chạy backend. Khi không cấu hình API, dữ liệu chạy thử được lưu riêng trong local storage của từng trình duyệt; người dùng khác và máy khác không nhìn thấy dữ liệu đó. Đăng nhập, quyền admin, phê duyệt tập trung, tài liệu trên máy chủ, PostgreSQL và phân tích F09 chỉ hoạt động khi giao diện kết nối backend.

Backend hiện chỉ chạy cục bộ ở `D:\DuAnTGPL\backend`, vì vậy website Pages chưa thể dùng chung dữ liệu hoặc đăng nhập bằng tài khoản admin hiện có. Để chạy thử các chức năng dùng chung trên Internet, cần triển khai backend và PostgreSQL lên máy chủ HTTPS, cấu hình CORS cho đúng tên miền Pages, lưu tệp bền vững và sao lưu dữ liệu. Không mở backend cục bộ hiện tại ra Internet.
